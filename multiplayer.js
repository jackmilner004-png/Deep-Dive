// Multiplayer: rooms joined by code, the same prompts for everyone, everyone's
// answers revealed after each prompt with a live leaderboard, and wins kept on
// each player's profile.
(function () {
  "use strict";

  const DD = window.DeepDive;
  const LEAD_MS = 4200;                 // lead-in before each prompt (the descent plays here)
  const ROUND_MS = DD.SECONDS * 1000;
  const GRACE_MS = 1500;                // allowance for answers still in flight
  const REVEAL_MS = 8000;               // how long everyone's answers stay up
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CODE_LENGTH = 5;
  const NAME_MAX = 20;

  const byText = new Map(DD.PROMPTS.map((p) => [p.prompt, p]));
  const $ = (sel) => document.querySelector(sel);
  const el = {
    home: $("#screen-mp"),
    lobby: $("#screen-lobby"),
    play: $("#screen-mp-play"),
    end: $("#screen-mp-end"),
    status: $("#mp-status"),
    name: $("#mp-name"),
    profile: $("#mp-profile"),
    create: $("#mp-create"),
    joinForm: $("#mp-join-form"),
    code: $("#mp-code"),
    homeError: $("#mp-home-error"),
    lobbyCode: $("#lobby-code"),
    lobbyLink: $("#lobby-link"),
    copyLink: $("#lobby-copy"),
    copied: $("#lobby-copied"),
    lobbyPlayers: $("#lobby-players"),
    startBtn: $("#lobby-start"),
    lobbyWait: $("#lobby-wait"),
    modes: $("#lobby-modes"),
    progress: $("#mp-progress"),
    roomTag: $("#mp-room-tag"),
    category: $("#mp-category"),
    oxygen: $("#mp-oxygen"),
    oxygenFill: $("#mp-oxygen-fill"),
    seconds: $("#mp-seconds"),
    form: $("#mp-answer-form"),
    input: $("#mp-answer"),
    feedback: $("#mp-feedback"),
    waiting: $("#mp-waiting"),
    countdown: $("#mp-countdown"),
    reveal: $("#mp-reveal"),
    board: $("#mp-board"),
    endTitle: $("#mp-end-title"),
    endWinner: $("#mp-end-winner"),
    endBoard: $("#mp-end-board"),
    again: $("#mp-again"),
    endWait: $("#mp-end-wait"),
  };

  let net = null, uid = null;
  let profile = { name: "", wins: 0, dives: 0 };
  let code = null, room = null, offRoom = null, offProfile = null, timer = 0;
  let mine = freshRound(-1);            // this player's state for the current round
  let lastAdvanceTry = 0, countedDive = null;
  const profiles = {};                  // uid -> profile, for wins shown in the lobby

  function freshRound(r) {
    return { round: r, diveId: null, answered: false, claiming: false, revealSince: 0, descended: false };
  }

  const esc = (s) => DD.escapeHtml(String(s ?? ""));
  const nameOf = (id) => (room && room.players && room.players[id] && room.players[id].name) || "Diver";

  // ---------- home: profile, create, join ----------

  async function openHome(message) {
    leaveRoomLocally();
    DD.setDepth(0);
    DD.show(el.home);
    el.homeError.textContent = message || "";
    const fromLink = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
    if (fromLink && !message) el.code.value = fromLink;
    el.status.textContent = "Connecting…";
    el.status.hidden = false;
    setConnected(false);
    try { net = await DeepDiveNet.connect(); }
    catch (e) { net = null; el.status.textContent = "Couldn't reach the multiplayer server. Check your connection and try again."; return; }
    if (!net) {
      el.status.textContent = "Multiplayer isn't switched on for this site yet. The site owner needs to add a Firebase config (see the README).";
      return;
    }
    uid = await net.ready();
    el.status.hidden = true;
    setConnected(true);
    if (offProfile) offProfile();
    offProfile = net.on(`players/${uid}`, (p) => {
      profile = Object.assign({ name: "", wins: 0, dives: 0 }, p || {});
      if (!el.name.value.trim()) el.name.value = profile.name || DD.load("mpName", "");
      renderProfile();
    });
    // Already in the linked room (e.g. after a reload): go straight back in.
    if (fromLink && !message && await net.get(`rooms/${fromLink}/players/${uid}/name`)) enterRoom(fromLink);
  }

  // Create and Join stay disabled until the connection (and sign-in) is ready.
  function setConnected(ok) {
    const join = el.joinForm.querySelector("button");
    el.create.disabled = join.disabled = !ok;
    el.create.textContent = ok ? "Create a room" : "Connecting…";
  }

  function renderProfile() {
    el.profile.innerHTML = `
      <div><dt>Wins</dt><dd>${DD.fmt(profile.wins || 0)}</dd></div>
      <div><dt>Multiplayer dives</dt><dd>${DD.fmt(profile.dives || 0)}</dd></div>`;
  }

  function currentName() {
    const n = el.name.value.trim().slice(0, NAME_MAX);
    return n;
  }

  async function saveName() {
    const n = currentName();
    if (!n) { el.homeError.textContent = "Enter a name first, so others can see who you are."; el.name.focus(); return null; }
    DD.save("mpName", n);
    if (n !== profile.name) await net.update(`players/${uid}`, { name: n });
    return n;
  }

  function newCode() {
    let c = "";
    for (let i = 0; i < CODE_LENGTH; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }

  async function createRoom() {
    if (!net) return;
    const name = await saveName();
    if (!name) return;
    let c = newCode();
    for (let i = 0; i < 5 && (await net.get(`rooms/${c}/host`)); i++) c = newCode();
    await net.set(`rooms/${c}`, {
      host: uid,
      createdAt: net.serverNow(),
      players: { [uid]: { name, joinedAt: net.serverNow(), online: true } },
    });
    enterRoom(c);
  }

  async function joinRoom(e) {
    e.preventDefault();
    if (!net) return;
    const c = el.code.value.trim().toUpperCase();
    if (!c) { el.homeError.textContent = "Enter the room code you were given."; return; }
    const name = await saveName();
    if (!name) return;
    if (!(await net.get(`rooms/${c}/host`))) { el.homeError.textContent = `There's no room with code ${c}. Check the code and try again.`; return; }
    await net.update(`rooms/${c}/players/${uid}`, { name, joinedAt: net.serverNow(), online: true });
    enterRoom(c);
  }

  function enterRoom(c) {
    code = c;
    el.homeError.textContent = "";
    net.setOnDisconnect(`rooms/${c}/players/${uid}/online`, false);
    try { history.replaceState(null, "", location.pathname + "?" + roomQuery(c) + location.hash); } catch (e) { /* ignore */ }
    offRoom = net.on(`rooms/${c}`, (r) => {
      room = r;
      if (!room) { openHome("That room has closed."); return; }
      if (room.players && room.players[uid] && room.players[uid].online === false) {
        net.update(`rooms/${c}/players/${uid}`, { online: true });
      }
      update();
    });
    clearInterval(timer);
    timer = setInterval(update, 100);
  }

  function roomQuery(c) {
    const p = new URLSearchParams(location.search);
    p.set("room", c);
    return p.toString();
  }

  function leaveRoomLocally() {
    if (offRoom) offRoom();
    offRoom = null;
    clearInterval(timer);
    room = null;
    code = null;
    mine = freshRound(-1);
  }

  async function leaveRoom() {
    if (net && code && room) {
      const c = code;
      // One atomic change: drop this player, hand over host, close an empty room.
      // (Returning null for an unknown value lets Firebase fetch it and retry.)
      const leaving = net.transaction(`rooms/${c}`, (r) => {
        if (!r) return r;
        if (!r.players || !r.players[uid]) return undefined;
        delete r.players[uid];
        const others = Object.keys(r.players);
        if (!others.length) return null;
        if (r.host === uid) r.host = others[0];
        return r;
      });
      leaveRoomLocally();
      await leaving;
    }
    try {
      const p = new URLSearchParams(location.search); p.delete("room");
      history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
    } catch (e) { /* ignore */ }
  }

  // ---------- room state machine ----------

  const isHost = () => room && room.host === uid;
  const playerIds = () => Object.keys((room && room.players) || {})
    .sort((a, b) => (room.players[a].joinedAt || 0) - (room.players[b].joinedAt || 0));
  const activeIds = () => playerIds().filter((id) => room.players[id].online !== false);

  // Feeding frenzy: the first right answer claims the round; nobody else scores.
  const isFrenzy = (dive) => !!dive && dive.mode === "frenzy";

  // Who scored what on round r, as { uid: answer }. In a frenzy only the claimer appears.
  function answersFor(dive, r) {
    if (isFrenzy(dive)) {
      const c = dive.claims && dive.claims[r];
      return c ? { [c.uid]: c } : {};
    }
    return (dive && dive.answers && dive.answers[r]) || {};
  }

  function totals(dive, uptoRound) {
    const t = {};
    playerIds().forEach((id) => { t[id] = 0; });
    for (let r = 0; r <= uptoRound; r++) {
      const a = answersFor(dive, r);
      Object.keys(a).forEach((id) => { t[id] = (t[id] || 0) + (a[id].points || 0) * DD.METRES_PER_POINT; });
    }
    return t;
  }

  function update() {
    if (!room) return;
    const dive = room.dive;
    if (!dive || !dive.state || dive.state.status === "lobby") return renderLobby();
    if (dive.state.status === "done") return renderEnd(dive);
    renderPlay(dive);
  }

  function renderLobby() {
    const ids = playerIds();
    const key = JSON.stringify([code, room.players, room.host, room.mode, ids.map((id) => profiles[id] && profiles[id].wins)]);
    if (!el.lobby.hidden && el.lobby.dataset.key === key) return;
    el.lobby.dataset.key = key;
    DD.show(el.lobby);
    el.lobbyCode.textContent = code;
    el.lobbyLink.value = location.origin + location.pathname + "?" + roomQuery(code);
    el.lobbyPlayers.innerHTML = ids.map((id) => `
      <li class="${id === uid ? "me" : ""}${room.players[id].online === false ? " away" : ""}">
        <span class="who">${esc(room.players[id].name)}${id === uid ? " <em>you</em>" : ""}${id === room.host ? ' <span class="host">host</span>' : ""}</span>
        <span class="wins">${profiles[id] ? DD.fmt(profiles[id].wins || 0) + " wins" : ""}</span>
      </li>`).join("");
    ids.filter((id) => !profiles[id]).forEach(async (id) => {
      profiles[id] = { wins: 0 };
      profiles[id] = (await net.get(`players/${id}`)) || { wins: 0 };
    });
    const mode = room.mode || "classic";
    el.modes.classList.toggle("readonly", !isHost());
    el.modes.querySelectorAll("[data-mode]").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.mode === mode));
      b.disabled = !isHost();
    });
    el.startBtn.hidden = !isHost();
    el.lobbyWait.hidden = isHost();
    el.lobbyWait.textContent = `Waiting for ${nameOf(room.host)} to start the dive.`;
  }

  async function startDive() {
    if (!isHost()) return;
    // The host's own shuffled deck, so prompts don't repeat until the bank runs out.
    const prompts = Array.from({ length: DD.DIVE_LENGTH }, () => DD.drawPrompt().prompt);
    const id = ((room.dive && room.dive.id) || 0) + 1;
    await net.set(`rooms/${code}/dive`, {
      id, prompts, mode: room.mode || "classic",
      state: { status: "playing", round: 0, startedAt: net.serverNow() },
    });
  }

  function renderPlay(dive) {
    const st = dive.state, r = st.round, now = net.serverNow();
    if (mine.round !== r || mine.diveId !== dive.id) {
      mine = freshRound(r);
      mine.diveId = dive.id;
      el.input.value = "";
      el.feedback.textContent = "";
    }
    if (el.play.hidden) DD.show(el.play);
    const prompt = byText.get(dive.prompts[r]);
    const opens = st.startedAt + LEAD_MS;
    const closes = opens + ROUND_MS;
    const frenzy = isFrenzy(dive);
    const answers = (dive.answers && dive.answers[r]) || {};
    const claim = frenzy && dive.claims && dive.claims[r];
    const everyoneIn = frenzy ? !!claim : activeIds().every((id) => answers[id]);
    const t = totals(dive, r - 1);

    el.progress.textContent = `${frenzy ? "Feeding frenzy · " : ""}Prompt ${r + 1} of ${dive.prompts.length}`;
    el.roomTag.textContent = `Room ${code}`;
    // In a frenzy the question stays hidden until the answer box opens: no thinking time.
    el.category.textContent = frenzy && now < opens ? "Get ready…" : (prompt ? prompt.prompt : dive.prompts[r]);
    renderBoard(dive, r, everyoneIn || now >= closes + GRACE_MS);

    // 1. lead-in: the diver sinks to the depth earned on the last prompt
    if (now < opens) {
      showParts({ countdown: true });
      el.countdown.textContent = frenzy
        ? `Question in ${Math.ceil((opens - now) / 1000)} · first right answer claims it`
        : (r === 0 ? `Get ready · ${Math.ceil((opens - now) / 1000)}` : "Next prompt coming up");
      DD.setDepth(t[uid] || 0);
      if (r > 0 && !mine.descended) {
        mine.descended = true;
        const was = totals(dive, r - 2);
        const before = was[uid] || 0, after = t[uid] || 0;
        const a = answersFor(dive, r - 1)[uid];
        const tier = a && a.tier >= 0 ? a.tier : -1;
        const lastClaim = frenzy && dive.claims && dive.claims[r - 1];
        const note = tier >= 0 ? `${DD.TIERS[tier].name} · +${DD.fmt(after - before)} m`
          : frenzy ? (lastClaim ? `${nameOf(lastClaim.uid)} claimed it · holding depth` : "Nobody claimed it · holding depth")
          : "Out of air · holding depth";
        const divers = playerIds().map((id) => ({ name: nameOf(id), from: was[id] || 0, to: t[id] || 0, me: id === uid }));
        DD.descendGroup(divers, note, tier, Math.max(opens - now - 450, 600));
      }
      return;
    }

    // 2. the prompt is open
    if (!everyoneIn && now < closes + GRACE_MS) {
      if (!prompt && !frenzy) { if (!mine.answered) sendAnswer(null, ""); }
      if (frenzy || !mine.answered) {
        const left = Math.max(0, (closes - now) / 1000);
        showParts({ form: true, oxygen: true });
        el.oxygenFill.style.transform = `scaleX(${left / DD.SECONDS})`;
        el.oxygen.classList.toggle("low", left <= 7);
        el.seconds.textContent = Math.ceil(left);
        if (left <= 0) { if (!frenzy) sendAnswer(null, ""); }
        else if (document.activeElement !== el.input && !el.input.disabled) el.input.focus();
      } else {
        showParts({ waiting: true });
        const ids = activeIds();
        const done = ids.filter((id) => answers[id]).length;
        el.waiting.innerHTML = `<p class="label">Answer locked in · ${done} of ${ids.length} divers answered</p>
          <ul class="answered">${ids.map((id) => `<li class="${answers[id] ? "in" : ""}">${esc(nameOf(id))}${id === uid ? " (you)" : ""}</li>`).join("")}</ul>`;
      }
      return;
    }

    // 3. reveal everyone's answers, then move on
    if (!mine.revealSince) mine.revealSince = now;
    showParts({ reveal: true });
    if (frenzy) renderFrenzyReveal(prompt, claim, r);
    else renderReveal(prompt, answers, r);
    const waited = now - mine.revealSince;
    if ((isHost() && waited > REVEAL_MS) || waited > REVEAL_MS + 7000) advance(dive, r);
  }

  function showParts(on) {
    el.countdown.hidden = !on.countdown;
    el.form.hidden = !on.form;
    el.oxygen.hidden = !on.oxygen;
    el.feedback.hidden = !on.form;
    el.waiting.hidden = !on.waiting;
    el.reveal.hidden = !on.reveal;
  }

  function submit(e) {
    e.preventDefault();
    if (!room || mine.answered) return;
    const dive = room.dive, prompt = byText.get(dive.prompts[dive.state.round]);
    const raw = el.input.value.trim();
    if (!raw || !prompt) return;
    if (isFrenzy(dive) && net.serverNow() < dive.state.startedAt + LEAD_MS) return;
    const hit = DD.match(prompt, raw);
    if (hit && isFrenzy(dive)) return claimRound(hit);
    if (hit) return sendAnswer(hit, raw);
    el.feedback.textContent = `“${raw}” isn't on our list. Try another.`;
    el.feedback.className = "feedback miss";
    el.form.classList.remove("shake");
    void el.form.offsetWidth;
    el.form.classList.add("shake");
    el.input.select();
  }

  function sendAnswer(hit, raw) {
    if (mine.answered) return;
    mine.answered = true;
    el.input.blur();
    const r = mine.round;
    net.set(`rooms/${code}/dive/answers/${r}/${uid}`, {
      answer: hit ? hit.label : null,
      tier: hit ? hit.tier : -1,
      points: hit ? DD.TIERS[hit.tier].points : 0,
      at: net.serverNow(),
    });
  }

  // First valid answer wins: one atomic write, so two near-simultaneous answers
  // can't both claim the round.
  async function claimRound(hit) {
    if (mine.claiming) return;
    mine.claiming = true;
    const r = mine.round;
    el.input.disabled = true;
    const res = await net.transaction(`rooms/${code}/dive/claims/${r}`, (cur) => (cur ? undefined : {
      uid, answer: hit.label, tier: hit.tier, points: DD.TIERS[hit.tier].points, at: net.serverNow(),
    }));
    el.input.disabled = false;
    mine.claiming = false;
    if (!res.committed && res.value && res.value.uid !== uid && mine.round === r) {
      el.feedback.textContent = `Too slow: ${nameOf(res.value.uid)} got there first.`;
      el.feedback.className = "feedback miss";
    }
  }

  function renderFrenzyReveal(prompt, claim, r) {
    const key = JSON.stringify([r, claim]);
    if (el.reveal.dataset.key === key) return;
    el.reveal.dataset.key = key;
    const rarest = prompt && prompt.byTier[5][0];
    const tier = claim ? claim.tier : -1;
    el.reveal.innerHTML = `
      <p class="label">${claim ? (claim.uid === uid ? "You claimed this round" : "Round claimed") : "Nobody claimed this round"}</p>
      ${claim ? `<ol class="answers"><li class="tier-${tier}${claim.uid === uid ? " me" : ""}" style="--i:0">
          <span class="who">${esc(nameOf(claim.uid))}${claim.uid === uid ? " <em>you</em>" : ""}</span>
          <span class="what">${esc(claim.answer)}</span>
          <span class="chip">${DD.TIERS[tier].name}</span>
          <span class="gain">+${DD.fmt(claim.points * DD.METRES_PER_POINT)} m</span>
        </li></ol>` : ""}
      ${rarest ? `<p class="deeper"><span class="label">Leviathan answer</span><span class="pill tier-5">${esc(rarest.label)}</span></p>${DD.factHtml(prompt.prompt)}` : ""}`;
  }

  function renderReveal(prompt, answers, r) {
    const key = JSON.stringify([r, answers]);
    if (el.reveal.dataset.key === key) return;
    el.reveal.dataset.key = key;
    const rows = playerIds().map((id) => ({ id, a: answers[id] }))
      .sort((x, y) => ((y.a && y.a.points) || 0) - ((x.a && x.a.points) || 0));
    const rarest = prompt && prompt.byTier[5][0];
    el.reveal.innerHTML = `
      <p class="label">Everyone's answers</p>
      <ol class="answers">${rows.map(({ id, a }, i) => {
        const tier = a && a.tier >= 0 ? a.tier : -1;
        return `<li class="tier-${tier < 0 ? "out" : tier}${id === uid ? " me" : ""}" style="--i:${i}">
          <span class="who">${esc(nameOf(id))}${id === uid ? " <em>you</em>" : ""}</span>
          <span class="what">${tier < 0 ? "Out of air" : esc(a.answer)}</span>
          <span class="chip">${tier < 0 ? "0 m" : DD.TIERS[tier].name}</span>
          <span class="gain">+${DD.fmt(tier < 0 ? 0 : a.points * DD.METRES_PER_POINT)} m</span>
        </li>`;
      }).join("")}</ol>
      ${rarest ? `<p class="deeper"><span class="label">Leviathan answer</span><span class="pill tier-5">${esc(rarest.label)}</span></p>${DD.factHtml(prompt.prompt)}` : ""}`;
  }

  function renderBoard(dive, r, revealed) {
    const upto = revealed ? r : r - 1;
    const t = totals(dive, upto), prev = totals(dive, upto - 1);
    const ids = playerIds().sort((a, b) => t[b] - t[a]);
    const key = JSON.stringify([upto, t]);
    if (el.board.dataset.key === key) return;
    el.board.dataset.key = key;
    el.board.innerHTML = `<p class="label">Leaderboard</p><ol class="board">${ids.map((id, i) => `
      <li class="${id === uid ? "me" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="who">${esc(nameOf(id))}${id === uid ? " <em>you</em>" : ""}</span>
        <span class="depth">${DD.fmt(t[id])} m</span>
        <span class="delta">${t[id] > prev[id] ? "+" + DD.fmt(t[id] - prev[id]) : ""}</span>
      </li>`).join("")}</ol>`;
  }

  async function advance(dive, r) {
    const now = Date.now();
    if (now - lastAdvanceTry < 1000) return;
    lastAdvanceTry = now;
    await net.transaction(`rooms/${code}/dive/state`, (s) => {
      if (!s) return s;
      if (s.status !== "playing" || s.round !== r) return undefined;
      if (r + 1 >= dive.prompts.length) return Object.assign({}, s, { status: "done" });
      return Object.assign({}, s, { round: r + 1, startedAt: net.serverNow() });
    });
  }

  // ---------- end of dive ----------

  function renderEnd(dive) {
    const t = totals(dive, dive.prompts.length - 1);
    const ids = playerIds().sort((a, b) => t[b] - t[a]);
    // In a frenzy everyone present took part, even without claiming a round.
    const answered = isFrenzy(dive) ? ids
      : ids.filter((id) => Object.values(dive.answers || {}).some((a) => a && a[id]));
    const best = Math.max(0, ...ids.map((id) => t[id]));
    const winners = best > 0 && answered.length >= 2 ? ids.filter((id) => t[id] === best) : [];
    const key = JSON.stringify([dive.id, t, winners, room.host, room.players]);
    countWin(dive, winners, answered);
    if (!el.end.hidden && el.end.dataset.key === key) return;
    el.end.dataset.key = key;
    DD.show(el.end);
    DD.setDepth(t[uid] || 0);

    el.endTitle.textContent = `Room ${code} · ${isFrenzy(dive) ? "feeding frenzy" : "dive"} complete`;
    el.endWinner.textContent = !winners.length
      ? (answered.length < 2 ? "Wins count when two or more divers play." : "Nobody scored this time.")
      : winners.includes(uid)
        ? (winners.length > 1 ? "You tied for the deepest dive. +1 win" : "You dived deepest. +1 win")
        : `${winners.map(nameOf).join(" and ")} dived deepest.`;
    el.endBoard.innerHTML = ids.map((id, i) => `
      <li class="${id === uid ? "me" : ""}${winners.includes(id) ? " winner" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="who">${esc(nameOf(id))}${id === uid ? " <em>you</em>" : ""}</span>
        <span class="tiers">${dive.prompts.map((_, r) => {
          const a = answersFor(dive, r)[id];
          return a && a.tier >= 0 ? DD.TIERS[a.tier].glyph : "⬛";
        }).join("")}</span>
        <span class="depth">${DD.fmt(t[id])} m</span>
      </li>`).join("");
    el.again.hidden = !isHost();
    el.endWait.hidden = isHost();
    el.endWait.textContent = `Waiting for ${nameOf(room.host)} to start another dive.`;
  }

  // Each player records their own result once per dive, guarded by a flag in
  // the room so a reload can't count it twice.
  async function countWin(dive, winners, answered) {
    const id = `${code}:${dive.id}`;
    if (countedDive === id || !answered.includes(uid)) return;
    countedDive = id;
    const won = winners.includes(uid);
    const flag = await net.transaction(`rooms/${code}/dive/counted/${uid}`, (cur) => (cur ? undefined : { won }));
    if (!flag.committed) return;
    await net.transaction(`players/${uid}`, (p) => {
      p = p || { name: profile.name };
      return Object.assign({}, p, { wins: (p.wins || 0) + (won ? 1 : 0), dives: (p.dives || 0) + 1 });
    });
  }

  // ---------- wiring ----------

  // Only offer multiplayer once a backend is configured (or ?local=1 for same-device play).
  const params = new URLSearchParams(location.search);
  $("#open-mp").hidden = !(window.DEEP_DIVE_FIREBASE || params.get("local") === "1");

  $("#open-mp").addEventListener("click", () => openHome());
  el.create.addEventListener("click", createRoom);
  el.joinForm.addEventListener("submit", joinRoom);
  el.form.addEventListener("submit", submit);
  el.startBtn.addEventListener("click", startDive);
  el.modes.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (b && isHost() && room) net.update(`rooms/${code}`, { mode: b.dataset.mode });
  });
  el.again.addEventListener("click", startDive);
  el.name.addEventListener("change", () => { if (net && currentName()) saveName(); });
  el.copyLink.addEventListener("click", () => {
    const done = () => { el.copied.textContent = "Link copied"; };
    const fallback = () => { el.lobbyLink.select(); el.copied.textContent = "Selected. Press Ctrl+C or ⌘C to copy."; };
    try { navigator.clipboard.writeText(el.lobbyLink.value).then(done, fallback); } catch (e) { fallback(); }
  });
  document.querySelectorAll("[data-leave]").forEach((b) => b.addEventListener("click", async () => {
    await leaveRoom();
    openHome();
  }));
  document.addEventListener("deepdive:menu", () => { leaveRoom(); if (offProfile) offProfile(); offProfile = null; });

  // Opening a shared room link goes straight to the join screen with the code filled in.
  if (new URLSearchParams(location.search).get("room")) openHome();
})();
