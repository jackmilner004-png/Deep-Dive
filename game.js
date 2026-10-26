(function () {
  "use strict";

  const SECONDS = 25;
  const PENALTY = 2;            // seconds lost for an answer that isn't on the list
  const DIVE_LENGTH = 7;
  const ENDLESS_TANKS = 3;      // endless mode ends after this many timeouts
  const METRES_PER_POINT = 10;
  const OCEAN_FLOOR = 11000;    // gauge scale; Challenger Deep is ~10,935 m

  const TIERS = [
    { name: "Plankton",   points: 10,  glyph: "🟦" },
    { name: "Krill",      points: 25,  glyph: "🟩" },
    { name: "Seahorse",   points: 40,  glyph: "🟨" },
    { name: "Octopus",    points: 60,  glyph: "🟧" },
    { name: "Anglerfish", points: 85,  glyph: "🟥" },
    { name: "Leviathan",  points: 100, glyph: "🟪" },
  ];

  const ZONES = [
    { from: 0,     name: "Sunlight zone" },
    { from: 200,   name: "Twilight zone" },
    { from: 1000,  name: "Midnight zone" },
    { from: 4000,  name: "Abyssal zone" },
    { from: 6000,  name: "Hadal zone" },
    { from: 10935, name: "Below the Challenger Deep" },
  ];

  // ---------- prompt bank ----------

  function norm(s) {
    return s.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .trim()
      .replace(/^(the|a|an)\s+/, "")
      .replace(/[^a-z0-9+#]/g, "");
  }

  function titleCase(s) {
    if (/^[a-z]{1,3}[\d+#-]/.test(s) || s.length <= 2) return s.toUpperCase();
    return s.replace(/(^|[\s(-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }

  const PROMPTS = window.DEEP_DIVE_PROMPTS.map((line, id) => {
    const [prompt, ...tiers] = line.split("|").map((p) => p.trim());
    const lookup = new Map();
    const byTier = tiers.map((group, tier) =>
      group.split(",").map((a) => a.trim()).filter(Boolean).map((answer) => {
        const spellings = answer.split("/").map((x) => x.trim());
        const entry = { label: titleCase(spellings[0]), tier };
        spellings.forEach((sp) => {
          const key = norm(sp);
          if (key && !lookup.has(key)) lookup.set(key, entry);
        });
        return entry;
      })
    );
    return { id, prompt, byTier, lookup };
  });

  function levenshtein(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[b.length];
  }

  function match(p, raw) {
    const key = norm(raw);
    if (!key) return null;
    const tries = [key, key.replace(/es$/, ""), key.replace(/s$/, ""), key + "s"];
    for (const t of tries) if (p.lookup.has(t)) return p.lookup.get(t);
    if (key.length < 5) return null;
    const allowed = key.length >= 9 ? 2 : 1;
    let best = null, bestD = allowed + 1, tie = false;
    p.lookup.forEach((entry, k) => {
      if (k.length < 4) return;
      const d = levenshtein(key, k);
      if (d < bestD) { best = entry; bestD = d; tie = false; }
      else if (d === bestD && entry !== best) tie = true;
    });
    return best && !tie ? best : null;
  }

  // ---------- storage (per-browser conveniences) ----------

  function load(key, fallback) {
    try { const v = localStorage.getItem("deepdive." + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem("deepdive." + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // A shuffled deck of prompt ids, kept across visits so prompts don't repeat
  // until the whole bank has been seen; then it reshuffles.
  let deck = load("deck", []).filter((id) => id < PROMPTS.length);
  function drawPrompt() {
    if (!deck.length) deck = shuffle(PROMPTS.map((p) => p.id));
    const id = deck.shift();
    save("deck", deck);
    return PROMPTS[id];
  }

  // ---------- state ----------

  const stats = Object.assign({ dives: 0, best: 0, bestEndless: 0, prompts: 0 }, load("stats", {}));
  let game = null;
  let rafId = 0;

  const $ = (sel) => document.querySelector(sel);
  const el = {
    app: $("#app"),
    sea: $("#sea"),
    start: $("#screen-start"),
    play: $("#screen-play"),
    end: $("#screen-end"),
    depthNow: $("#depth-now"),
    zoneNow: $("#zone-now"),
    marker: $("#gauge-marker"),
    progress: $("#progress"),
    tanks: $("#tanks"),
    category: $("#category"),
    oxygen: $("#oxygen"),
    oxygenFill: $("#oxygen-fill"),
    seconds: $("#seconds"),
    form: $("#answer-form"),
    input: $("#answer"),
    feedback: $("#feedback"),
    reveal: $("#reveal"),
    next: $("#next"),
    stats: $("#stats"),
    endDepth: $("#end-depth"),
    endZone: $("#end-zone"),
    endTitle: $("#end-title"),
    log: $("#log"),
    shareText: $("#share-text"),
    copy: $("#copy"),
    copied: $("#copied"),
  };

  function zoneFor(m) {
    let z = ZONES[0];
    for (const zone of ZONES) if (m >= zone.from) z = zone;
    return z.name;
  }

  function fmt(n) { return n.toLocaleString("en-GB"); }

  function setDepth(metres) {
    el.depthNow.textContent = fmt(metres) + " m";
    el.zoneNow.textContent = zoneFor(metres);
    const t = Math.min(metres / OCEAN_FLOOR, 1);
    el.marker.style.setProperty("--t", t);
    // Water darkens as you sink: lightness falls from the sunlit surface to the trench.
    const top = 30 - 27 * Math.pow(t, 0.6);
    const bottom = 16 - 14 * Math.pow(t, 0.5);
    el.sea.style.setProperty("--sea-top", `hsl(${193 + 30 * t} 62% ${top}%)`);
    el.sea.style.setProperty("--sea-bottom", `hsl(${210 + 25 * t} 70% ${bottom}%)`);
  }

  function show(screen) {
    [el.start, el.play, el.end].forEach((s) => { s.hidden = s !== screen; });
    window.scrollTo({ top: 0 });
  }

  // ---------- start ----------

  function renderStats() {
    el.stats.innerHTML = stats.dives
      ? `<div><dt>Dives</dt><dd>${fmt(stats.dives)}</dd></div>
         <div><dt>Deepest dive</dt><dd>${fmt(stats.best)} m</dd></div>
         <div><dt>Deepest endless</dt><dd>${fmt(stats.bestEndless)} m</dd></div>
         <div><dt>Prompts answered</dt><dd>${fmt(stats.prompts)}</dd></div>`
      : `<div><dt>Prompt bank</dt><dd>${PROMPTS.length} categories</dd></div>
         <div><dt>Answers known</dt><dd>${fmt(PROMPTS.reduce((n, p) => n + p.byTier.flat().length, 0))}</dd></div>`;
  }

  function startGame(mode) {
    game = { mode, round: 0, depth: 0, shownDepth: 0, tanks: ENDLESS_TANKS, log: [] };
    setDepth(0);
    show(el.play);
    nextPrompt();
  }

  // ---------- play ----------

  function nextPrompt() {
    if (game.mode === "dive" && game.round >= DIVE_LENGTH) return endGame();
    if (game.mode === "endless" && game.tanks <= 0) return endGame();
    game.round += 1;
    game.prompt = drawPrompt();
    game.timeLeft = SECONDS;
    game.answering = true;

    el.progress.textContent = game.mode === "dive"
      ? `Prompt ${game.round} of ${DIVE_LENGTH}`
      : `Endless · prompt ${game.round}`;
    el.tanks.hidden = game.mode !== "endless";
    el.tanks.innerHTML = Array.from({ length: ENDLESS_TANKS }, (_, i) =>
      `<span class="tank${i < game.tanks ? "" : " empty"}"></span>`).join("");
    el.tanks.setAttribute("aria-label", `${game.tanks} air tanks left`);

    el.category.textContent = game.prompt.prompt;
    el.feedback.textContent = "";
    el.feedback.className = "feedback";
    el.reveal.hidden = true;
    el.next.hidden = true;
    el.form.hidden = false;
    el.oxygen.hidden = false;
    el.input.value = "";
    el.input.disabled = false;
    el.input.focus();

    game.lastTick = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!game || !game.answering) return;
    game.timeLeft -= (now - game.lastTick) / 1000;
    game.lastTick = now;
    if (game.timeLeft <= 0) { game.timeLeft = 0; drawTimer(); return finishPrompt(null); }
    drawTimer();
    rafId = requestAnimationFrame(tick);
  }

  function drawTimer() {
    const f = Math.max(game.timeLeft / SECONDS, 0);
    el.oxygenFill.style.transform = `scaleX(${f})`;
    el.oxygen.classList.toggle("low", game.timeLeft <= 7);
    el.seconds.textContent = Math.ceil(game.timeLeft);
  }

  function submit(e) {
    e.preventDefault();
    if (!game || !game.answering) return;
    const raw = el.input.value.trim();
    if (!raw) return;
    const hit = match(game.prompt, raw);
    if (hit) return finishPrompt(hit);
    game.timeLeft -= PENALTY;
    el.feedback.textContent = `“${raw}” isn't on our list. −${PENALTY}s of air.`;
    el.feedback.className = "feedback miss";
    el.form.classList.remove("shake");
    void el.form.offsetWidth;
    el.form.classList.add("shake");
    el.input.select();
  }

  function finishPrompt(hit) {
    game.answering = false;
    cancelAnimationFrame(rafId);
    el.input.disabled = true;
    el.form.hidden = true;
    el.oxygen.hidden = true;
    el.feedback.textContent = "";

    const p = game.prompt;
    const rarest = p.byTier[5][0];
    let points = 0;
    if (hit) {
      points = TIERS[hit.tier].points;
      game.depth += points * METRES_PER_POINT;
      stats.prompts += 1;
      save("stats", stats);
    } else if (game.mode === "endless") {
      game.tanks -= 1;
    }
    game.log.push({ prompt: p.prompt, answer: hit ? hit.label : null, tier: hit ? hit.tier : -1, points });

    const deeper = hit
      ? shuffle(p.byTier.slice(hit.tier + 1, 5).flat()).slice(0, 3)
      : shuffle(p.byTier.slice(2, 5).flat()).slice(0, 3);
    const tier = hit ? TIERS[hit.tier] : null;
    const lastPrompt = game.mode === "dive" ? game.round >= DIVE_LENGTH : game.tanks <= 0;

    el.reveal.innerHTML = `
      ${hit
        ? `<p class="verdict tier-${hit.tier}"><span class="chip">${tier.name}</span>
             <strong>${escapeHtml(hit.label)}</strong> <span class="gain">+${fmt(points * METRES_PER_POINT)} m</span></p>`
        : `<p class="verdict out"><span class="chip">Out of air</span>
             <strong>No answer</strong> <span class="gain">+0 m</span>${game.mode === "endless" ? ` <span class="lost">−1 tank</span>` : ""}</p>`}
      ${deeper.length ? `<p class="deeper"><span class="label">${hit ? "Deeper answers" : "You could have said"}</span>
           ${deeper.map((d) => `<span class="pill tier-${d.tier}">${escapeHtml(d.label)}</span>`).join("")}</p>` : ""}
      ${!hit || hit.tier < 5
        ? `<p class="deeper"><span class="label">Leviathan answer</span>
             <span class="pill tier-5">${escapeHtml(rarest.label)}</span></p>`
        : `<p class="deeper"><span class="label">You found the rarest answer on the list.</span></p>`}`;
    el.next.textContent = lastPrompt ? "Surface and see your dive" : "Next prompt";
    el.reveal.hidden = false;
    el.next.hidden = false;
    el.next.focus();
  }

  // ---------- descent between prompts ----------

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = {
    root: $("#descent"),
    canvas: $("#descent-canvas"),
    diver: $("#diver"),
    depth: $("#descent-depth"),
    note: $("#descent-note"),
    zone: $("#descent-zone"),
  };

  function advance() {
    if (!game || game.answering || game.descending) return;
    const from = game.shownDepth, to = game.depth;
    const last = game.log[game.log.length - 1];
    game.descending = true;
    descend(from, to, last).then(() => {
      if (!game) return;
      game.descending = false;
      game.shownDepth = to;
      setDepth(to);
      nextPrompt();
    });
  }

  function descend(from, to, last) {
    if (reduceMotion) return Promise.resolve();
    const gain = to - from;
    const duration = gain > 0 ? Math.min(1300 + gain * 1.5, 2900) : 1100;
    const ppm = gain > 0 ? Math.min(Math.max(520 / gain, 0.55), 3) : 1; // pixels per metre
    const ctx = scene.canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W, H;
    function size() {
      W = scene.canvas.clientWidth; H = scene.canvas.clientHeight;
      scene.canvas.width = W * dpr; scene.canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    scene.note.textContent = last.tier < 0
      ? (game.mode === "endless" ? "Out of air · one tank used" : "Out of air · holding depth")
      : `${TIERS[last.tier].name} · +${fmt(gain)} m`;
    scene.note.className = "descent-note tier-" + (last.tier < 0 ? "out" : last.tier);
    scene.zone.textContent = "";
    scene.diver.classList.toggle("drifting", gain === 0);
    scene.root.hidden = false;
    document.body.classList.add("descending");
    size();

    const snow = Array.from({ length: 70 }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4,
      depth: Math.random() * 0.8 + 0.4, drift: Math.random() * 2 - 1,
    }));
    const bubbles = [];
    let zoneName = zoneFor(from);
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    return new Promise((resolve) => {
      let start = 0, prev = 0, prevCam = from, done = false;
      function finish() {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("keydown", skip);
        scene.root.removeEventListener("click", skip);
        window.removeEventListener("resize", size);
        scene.root.classList.add("leaving");
        setTimeout(() => {
          scene.root.hidden = true;
          scene.root.classList.remove("leaving");
          document.body.classList.remove("descending");
          resolve();
        }, 260);
      }
      function skip(e) {
        if (e.type === "keydown" && !["Enter", " ", "Escape"].includes(e.key)) return;
        if (e.type === "keydown") e.preventDefault();
        setDepth(to);
        scene.depth.textContent = fmt(to) + " m";
        finish();
      }
      // let the click/Enter that opened the scene settle before listening for a skip
      setTimeout(() => {
        if (done) return;
        window.addEventListener("keydown", skip);
        scene.root.addEventListener("click", skip);
      }, 150);
      window.addEventListener("resize", size);

      function frame(now) {
        if (!start) { start = prev = now; }
        const dt = Math.min((now - prev) / 1000, 0.05);
        prev = now;
        const t = Math.min((now - start) / duration, 1);
        const cam = from + gain * ease(t);
        const speed = (cam - prevCam) * ppm / Math.max(dt, 0.001); // px/s the water rushes past
        prevCam = cam;

        setDepth(Math.round(cam));
        scene.depth.textContent = fmt(Math.round(cam)) + " m";
        const z = zoneFor(cam);
        if (z !== zoneName) {
          zoneName = z;
          scene.zone.textContent = "Entering the " + z.replace(/ zone$/, "") + " zone";
          if (z.startsWith("Below")) scene.zone.textContent = z;
          scene.zone.classList.remove("flash"); void scene.zone.offsetWidth; scene.zone.classList.add("flash");
        }

        ctx.clearRect(0, 0, W, H);
        const cx = W / 2, cy = H * 0.42;

        // depth lines every 50 m, labelled every 100 m
        const span = H / ppm;
        const first = Math.floor((cam - span) / 50) * 50;
        ctx.font = "500 12px " + getComputedStyle(document.body).getPropertyValue("--mono");
        for (let d = Math.max(first, 0); d < cam + span; d += 50) {
          const y = cy + (d - cam) * ppm;
          const major = d % 100 === 0;
          ctx.strokeStyle = major ? "rgba(169,198,205,.28)" : "rgba(169,198,205,.12)";
          ctx.setLineDash(major ? [] : [4, 6]);
          ctx.beginPath(); ctx.moveTo(major ? 16 : 40, y); ctx.lineTo(W - 16, y); ctx.stroke();
          if (major) {
            ctx.fillStyle = "rgba(169,198,205,.6)";
            ctx.fillText(fmt(d) + " m", 18, y - 6);
          }
        }
        ctx.setLineDash([]);

        // marine snow streams upward as the diver sinks
        snow.forEach((s) => {
          s.y -= (speed * s.depth + 6) * dt;
          s.x += s.drift * 8 * dt;
          if (s.y < -4) { s.y = H + 4; s.x = Math.random() * W; }
          if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
          ctx.fillStyle = `rgba(230,246,248,${0.15 + s.depth * 0.3})`;
          ctx.beginPath();
          const stretch = Math.min(speed * s.depth * 0.02, 10);
          ctx.ellipse(s.x, s.y, s.r, s.r + stretch, 0, 0, Math.PI * 2);
          ctx.fill();
        });

        // bubbles from the regulator, at the bottom of the head-down diver
        if (Math.random() < 0.35) bubbles.push({ x: cx + 4 + Math.random() * 6, y: cy + 52, r: Math.random() * 3 + 1.5, wob: Math.random() * 6 });
        for (let i = bubbles.length - 1; i >= 0; i--) {
          const b = bubbles[i];
          b.y -= (70 + speed) * dt;
          b.wob += dt * 6;
          const bx = b.x + Math.sin(b.wob) * 3;
          if (b.y < -10) { bubbles.splice(i, 1); continue; }
          ctx.strokeStyle = "rgba(200,245,255,.55)";
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(bx, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
        }

        if (t < 1) raf = requestAnimationFrame(frame);
        else setTimeout(finish, gain > 0 ? 380 : 0);
      }
      let raf = requestAnimationFrame(frame);
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- end ----------

  function endGame() {
    const endless = game.mode === "endless";
    stats.dives += 1;
    const prevBest = endless ? stats.bestEndless : stats.best;
    if (endless) stats.bestEndless = Math.max(stats.bestEndless, game.depth);
    else stats.best = Math.max(stats.best, game.depth);
    save("stats", stats);

    el.endTitle.textContent = endless
      ? `Endless dive · ${game.log.length} prompts`
      : "Dive complete";
    el.endDepth.textContent = fmt(game.depth) + " m";
    el.endZone.textContent = zoneFor(game.depth) +
      (game.depth > prevBest && prevBest > 0 ? " · new personal best" : "");

    el.log.innerHTML = game.log.map((r) => `
      <li class="tier-${r.tier < 0 ? "out" : r.tier}">
        <span class="log-prompt">${escapeHtml(r.prompt)}</span>
        <span class="log-answer">${r.answer ? escapeHtml(r.answer) : "Out of air"}</span>
        <span class="chip">${r.tier < 0 ? "0 m" : TIERS[r.tier].name}</span>
        <span class="log-m">${fmt(r.points * METRES_PER_POINT)} m</span>
      </li>`).join("");

    el.shareText.value = `Deep Dive${endless ? " (endless)" : ""}: ${fmt(game.depth)} m, ${zoneFor(game.depth)}\n` +
      game.log.map((r) => (r.tier < 0 ? "⬛" : TIERS[r.tier].glyph)).join("");
    el.copied.textContent = "";
    show(el.end);
    renderStats();
  }

  function copyShare() {
    const text = el.shareText.value;
    const done = () => { el.copied.textContent = "Copied"; };
    const fallback = () => { el.shareText.focus(); el.shareText.select(); el.copied.textContent = "Selected. Press Ctrl+C or ⌘C to copy."; };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }

  // ---------- wiring ----------

  el.form.addEventListener("submit", submit);
  el.next.addEventListener("click", advance);
  el.copy.addEventListener("click", copyShare);
  document.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", () => startGame(b.dataset.start)));
  document.querySelectorAll("[data-menu]").forEach((b) =>
    b.addEventListener("click", () => {
      if (game) { game.answering = false; cancelAnimationFrame(rafId); }
      game = null;
      setDepth(0);
      renderStats();
      show(el.start);
    }));

  renderStats();
  setDepth(0);
  show(el.start);
})();
