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
    profileScreen: $("#screen-profile"),
    profName: $("#prof-name"),
    profBadge: $("#prof-badge"),
    profModes: $("#prof-modes"),
    profEmpty: $("#prof-empty"),
    profTiles: $("#prof-tiles"),
    profRarity: $("#prof-rarity"),
    profRecent: $("#prof-recent"),
    profCompare: $("#prof-compare"),
    profTip: $("#prof-tip"),
    progress: $("#mp-progress"),
    roomTag: $("#mp-room-tag"),
    category: $("#mp-category"),
    oxygen: $("#mp-oxygen"),
    oxygenFill: $("#mp-oxygen-fill"),
    seconds: $("#mp-seconds"),
    form: $("#mp-answer-form"),
    input: $("#mp-answer"),
    feedback: $("#mp-feedback"),
    suggest: $("#mp-suggest"),
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

  // Win milestones: 5, 10, 20, then each doubling. Each unlocks a showier badge.
  const WIN_TIERS = [
    { at: 5, name: "Glow" }, { at: 10, name: "Embers" }, { at: 20, name: "Flame" },
    { at: 40, name: "Plasma" }, { at: 80, name: "Aurora" }, { at: 160, name: "Prism" },
    { at: 320, name: "Dark matter" },
  ];
  const winLevel = (n) => WIN_TIERS.filter((t) => n >= t.at).length;

  function winsBadge(wins, big) {
    const n = wins || 0, lvl = winLevel(n);
    const tier = lvl ? WIN_TIERS[lvl - 1].name : "";
    const sparks = lvl >= 2 ? Array.from({ length: 6 + lvl }, (_, k) =>
      `<i style="--k:${k};--x:${8 + (k * 37) % 84}%;--y:${10 + (k * 29) % 80}%"></i>`).join("") : "";
    // The effect wraps only the number; "wins" sits beside it as plain text.
    return `<span class="wb lvl-${lvl}${big ? " wb-lg" : ""}"${tier ? ` title="${tier}: ${n} wins"` : ""}>` +
      `<span class="wb-core"><span class="wb-fx" aria-hidden="true">${sparks}</span>` +
      `<span class="wb-n">${DD.fmt(n)}</span></span>` +
      (big ? "" : `<span class="wb-unit">${n === 1 ? "win" : "wins"}</span>`) + `</span>`;
  }

  function nextMilestone(n) {
    const next = WIN_TIERS.find((t) => n < t.at);
    if (next) return `${next.name} at ${next.at} wins`;
    let at = WIN_TIERS[WIN_TIERS.length - 1].at;
    while (at <= n) at *= 2;
    return `Next milestone at ${DD.fmt(at)} wins`;
  }
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
      const acct = net.account && net.account();
      if (!el.name.value.trim()) el.name.value = profile.name || DD.load("mpName", "") || ((acct && acct.name) || "").split(" ")[0].slice(0, NAME_MAX);
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
      <div><dt>Wins${winLevel(profile.wins || 0) ? ` · ${WIN_TIERS[winLevel(profile.wins || 0) - 1].name}` : ""}</dt>
        <dd>${winsBadge(profile.wins, true)}</dd><dd class="wb-next">${nextMilestone(profile.wins || 0)}</dd></div>
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
    // A profile opened from the room stays up until a prompt is in play.
    if (viewing) {
      if (dive && dive.state && dive.state.status === "playing") closeProfile();
      else return;
    }
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
        <span class="who"><button type="button" class="who-link" data-profile="${esc(id)}" title="View profile"><b>${esc(room.players[id].name)}</b></button>${id === uid ? " <em>you</em>" : ""}${id === room.host ? ' <span class="host">host</span>' : ""}</span>
        <span class="wins">${profiles[id] ? winsBadge(profiles[id].wins) : ""}</span>
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
      hints.clear();
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
    if (!on.form) hints.clear();
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
    hints.offer(prompt, raw);
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
      ms: answerMs(),
    });
  }

  // Milliseconds from the question opening to this answer, for answer-speed stats.
  function answerMs() {
    const st = room && room.dive && room.dive.state;
    return st ? Math.max(0, Math.round(net.serverNow() - (st.startedAt + LEAD_MS))) : 0;
  }

  // First valid answer wins: one atomic write, so two near-simultaneous answers
  // can't both claim the round.
  async function claimRound(hit) {
    if (mine.claiming) return;
    mine.claiming = true;
    const r = mine.round;
    el.input.disabled = true;
    const res = await net.transaction(`rooms/${code}/dive/claims/${r}`, (cur) => (cur ? undefined : {
      uid, answer: hit.label, tier: hit.tier, points: DD.TIERS[hit.tier].points, at: net.serverNow(), ms: answerMs(),
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
        <span class="who"><button type="button" class="who-link" data-profile="${esc(id)}" title="View profile"><b>${esc(nameOf(id))}</b></button>${id === uid ? " <em>you</em>" : ""}</span>
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
    const sum = diveSummary(dive, won);
    const count = (p, extra) => Object.assign({}, p, {
      wins: (p.wins || 0) + (won ? 1 : 0),
      dives: (p.dives || 0) + 1,
    }, extra ? extra(p) : {});
    try {
      await net.transaction(`players/${uid}`, (p) => count(p || { name: profile.name },
        (q) => ({ stats: addToStats(q.stats, sum), history: addToHistory(q.history, sum) })));
    } catch (e) {
      // Older database rules refuse the stats fields: still record the win.
      console.warn("Deep Dive: couldn't save detailed stats", e);
      await net.transaction(`players/${uid}`, (p) => count(p || { name: profile.name }));
    }
  }

  // This player's numbers for one finished dive.
  function diveSummary(dive, won) {
    const t = totals(dive, dive.prompts.length - 1), ids = playerIds();
    const s = { mode: isFrenzy(dive) ? "frenzy" : "classic", rounds: dive.prompts.length, answers: 0, misses: 0,
      points: 0, tiers: [0, 0, 0, 0, 0, 0], msTotal: 0, msCount: 0, fastestMs: 0,
      depth: t[uid] || 0, place: 1 + ids.filter((id) => (t[id] || 0) > (t[uid] || 0)).length,
      players: ids.length, won };
    for (let r = 0; r < dive.prompts.length; r++) {
      const a = answersFor(dive, r)[uid];
      if (!a || !(a.tier >= 0)) { s.misses++; continue; }
      s.answers++; s.points += a.points || 0; s.tiers[a.tier]++;
      if (a.ms >= 0) { s.msTotal += a.ms; s.msCount++; s.fastestMs = s.fastestMs ? Math.min(s.fastestMs, a.ms) : a.ms; }
    }
    return s;
  }

  // Running totals per mode, stored on the player's profile.
  function addToStats(stats, s) {
    stats = Object.assign({}, stats || {});
    const m = Object.assign({ dives: 0, contested: 0, wins: 0, rounds: 0, answers: 0, misses: 0, points: 0,
      tiers: [0, 0, 0, 0, 0, 0], msTotal: 0, msCount: 0, fastestMs: 0, depthTotal: 0, bestDepth: 0,
      placeTotal: 0, podiums: 0 }, stats[s.mode] || {});
    const tiers = [0, 1, 2, 3, 4, 5].map((i) => ((m.tiers && m.tiers[i]) || 0) + s.tiers[i]);
    const contested = s.players >= 2;
    stats[s.mode] = Object.assign(m, {
      dives: m.dives + 1, contested: m.contested + (contested ? 1 : 0), wins: m.wins + (s.won ? 1 : 0),
      rounds: m.rounds + s.rounds, answers: m.answers + s.answers, misses: m.misses + s.misses,
      points: m.points + s.points, tiers, msTotal: m.msTotal + s.msTotal, msCount: m.msCount + s.msCount,
      fastestMs: s.fastestMs && (!m.fastestMs || s.fastestMs < m.fastestMs) ? s.fastestMs : m.fastestMs,
      depthTotal: m.depthTotal + s.depth, bestDepth: Math.max(m.bestDepth, s.depth),
      placeTotal: m.placeTotal + (contested ? s.place : 0),
      podiums: m.podiums + (contested && s.place <= 3 ? 1 : 0),
    });
    return stats;
  }

  // The last 30 dives, for the profile's recent-dives chart.
  function addToHistory(history, s) {
    const at = net.serverNow();
    const all = Object.assign({}, history || {}, {
      ["d" + at]: { mode: s.mode, depth: s.depth, place: s.place, players: s.players, won: s.won, at },
    });
    const keep = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 30);
    return Object.fromEntries(keep.map((k) => [k, all[k]]));
  }

  // ---------- diver profile (multiplayer stats) ----------

  const MODE_COLOUR = { classic: "#1fa98a", frenzy: "#d95926" };
  const RARITY_RAMP = ["#dcefff", "#afd6fb", "#82b9f2", "#5a9be6", "#3f7dd6", "#3264c2"]; // shallow -> deep
  const MODE_NAME = { classic: "Classic", frenzy: "Feeding frenzy" };
  let viewing = null;             // { id, back, off, data, mode }

  function openProfile(id) {
    if (!net || !id) return;
    closeProfile(true);
    const back = !el.end.hidden ? "end" : room ? "lobby" : "home";
    viewing = { id, back, mode: "all", data: null };
    el.profName.textContent = (room && room.players && room.players[id] && room.players[id].name) || "Diver";
    el.profTiles.innerHTML = el.profRarity.innerHTML = el.profRecent.innerHTML = el.profCompare.innerHTML = "";
    el.profEmpty.hidden = false;
    el.profEmpty.textContent = "Loading…";
    DD.show(el.profileScreen);
    viewing.off = net.on(`players/${id}`, (p) => { if (viewing && viewing.id === id) { viewing.data = p || {}; drawProfile(); } });
  }

  function closeProfile(silent) {
    if (!viewing) return;
    if (viewing.off) viewing.off();
    const back = viewing.back;
    viewing = null;
    el.profTip.hidden = true;
    if (silent) return;
    if (room) { el.lobby.dataset.key = ""; el.end.dataset.key = ""; update(); }
    else DD.show(el.home);
    if (!room && back === "home") renderProfile();
  }

  // Sum the per-mode totals into one set for "All".
  function statsFor(p, mode) {
    const s = (p && p.stats) || {};
    const pick = mode === "all" ? [s.classic, s.frenzy] : [s[mode]];
    const out = { dives: 0, contested: 0, wins: 0, rounds: 0, answers: 0, misses: 0, points: 0, tiers: [0, 0, 0, 0, 0, 0],
      msTotal: 0, msCount: 0, fastestMs: 0, depthTotal: 0, bestDepth: 0, placeTotal: 0, podiums: 0 };
    pick.filter(Boolean).forEach((m) => {
      Object.keys(out).forEach((k) => {
        if (k === "tiers") out.tiers = out.tiers.map((v, i) => v + ((m.tiers && m.tiers[i]) || 0));
        else if (k === "bestDepth") out.bestDepth = Math.max(out.bestDepth, m.bestDepth || 0);
        else if (k === "fastestMs") out.fastestMs = m.fastestMs && (!out.fastestMs || m.fastestMs < out.fastestMs) ? m.fastestMs : out.fastestMs;
        else out[k] += m[k] || 0;
      });
    });
    return out;
  }

  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
  const avg = (a, b, digits = 0) => (b ? (a / b).toFixed(digits) : "–");
  const secs = (ms) => (ms ? (ms / 1000).toFixed(1) + "s" : "–");

  function drawProfile() {
    const p = viewing.data || {}, mode = viewing.mode, s = statsFor(p, mode);
    el.profName.textContent = p.name || el.profName.textContent;
    el.profBadge.innerHTML = winsBadge(p.wins, true);
    el.profModes.querySelectorAll("[data-pmode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pmode === mode)));

    // Totals from before detailed tracking began only exist for "All".
    const games = mode === "all" ? Math.max(p.dives || 0, s.dives) : s.dives;
    const wins = mode === "all" ? Math.max(p.wins || 0, s.wins) : s.wins;
    el.profEmpty.hidden = s.dives > 0;
    el.profEmpty.textContent = !s.dives
      ? (games ? "Detailed stats start counting from the next multiplayer dive." : `No ${mode === "all" ? "multiplayer" : MODE_NAME[mode]} dives yet.`)
      : "";

    const tiles = [
      ["Games played", DD.fmt(games)],
      ["Wins", DD.fmt(wins)],
      ["Win rate", pct(s.wins, s.contested), "games with 2+ divers"],
      ["Answers", DD.fmt(s.answers), `${DD.fmt(s.rounds)} prompts`],
      ["Avg points per answer", avg(s.points, s.answers, 1), "out of 100"],
      ["Miss rate", pct(s.misses, s.rounds), mode === "frenzy" ? "rounds not claimed" : "prompts without a right answer"],
      ["Leviathans found", DD.fmt(s.tiers[5])],
      ["Avg answer time", secs(s.msCount ? s.msTotal / s.msCount : 0), s.fastestMs ? `fastest ${secs(s.fastestMs)}` : ""],
      ["Best dive", s.bestDepth ? DD.fmt(s.bestDepth) + " m" : "–", s.dives ? `avg ${DD.fmt(Math.round(s.depthTotal / s.dives))} m` : ""],
      ["Avg finish", s.contested ? "#" + avg(s.placeTotal, s.contested, 1) : "–", s.contested ? `${pct(s.podiums, s.contested)} top 3` : ""],
    ];
    el.profTiles.innerHTML = tiles.map(([k, v, sub]) => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ""}</dd></div>`).join("");

    drawRarity(s);
    drawRecent(p, mode);
    drawCompare(p);
  }

  function drawRarity(s) {
    const total = s.answers || 0, max = Math.max(1, ...s.tiers);
    el.profRarity.innerHTML = `<div class="rar">${DD.TIERS.map((t, i) => `
      <div class="rar-row" title="${t.name}: ${s.tiers[i]} answers (${pct(s.tiers[i], total)})">
        <span class="nm">${t.name}</span>
        <span class="rar-track"><span class="rar-fill" style="display:block;width:${(100 * s.tiers[i]) / max}%;background:${RARITY_RAMP[i]}"></span></span>
        <span class="val">${DD.fmt(s.tiers[i])} <span>${pct(s.tiers[i], total)}</span></span>
      </div>`).join("")}</div>`;
  }

  function drawRecent(p, mode) {
    const all = Object.values(p.history || {}).sort((a, b) => a.at - b.at);
    const list = all.filter((h) => mode === "all" || h.mode === mode).slice(-20);
    if (!list.length) { el.profRecent.innerHTML = `<p class="feedback">No dives to show yet.</p>`; return; }
    const W = 360, H = 170, padL = 34, padB = 14, padT = 16, n = 20;
    const top = Math.max(1000, ...list.map((h) => h.depth));
    const step = top > 4000 ? 2000 : top > 2000 ? 1000 : 500;
    const yMax = Math.ceil(top / step) * step;
    const y = (v) => padT + (H - padT - padB) * (1 - v / yMax);
    const slot = (W - padL) / n, bw = Math.max(6, Math.min(18, slot - 6));
    const grid = [];
    for (let v = 0; v <= yMax; v += step) grid.push(v);
    const bars = list.map((h, i) => {
      const x = padL + slot * (n - list.length + i) + (slot - bw) / 2, yt = y(h.depth), hgt = Math.max(2, y(0) - yt);
      const date = new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const tip = `<b>${DD.fmt(h.depth)} m</b>${MODE_NAME[h.mode]} · ${date}<br>${h.won ? "Won" : `Finished #${h.place} of ${h.players}`}`;
      return `<g class="bar" data-tip="${esc(tip)}">
        <rect x="${x - (slot - bw) / 2}" y="${padT}" width="${slot}" height="${H - padT - padB}" fill="transparent"/>
        <path d="M${x},${y(0)} V${yt + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${y(0)} Z" fill="${MODE_COLOUR[h.mode]}"/>
        ${h.won ? `<circle cx="${x + bw / 2}" cy="${yt - 8}" r="4.5" fill="#e8f6f8" stroke="#0c2a3d" stroke-width="2"/>` : ""}
      </g>`;
    }).join("");
    const modes = [...new Set(list.map((h) => h.mode))];
    el.profRecent.innerHTML = `<div class="recent">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Depth reached in the last ${list.length} dives">
        ${grid.map((v) => `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(169,198,205,${v ? 0.12 : 0.35})"/>
          <text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? v / 1000 + "k" : v}</text>`).join("")}
        ${bars}
      </svg>
      <div class="legend">${modes.map((m) => `<span><i style="background:${MODE_COLOUR[m]}"></i>${MODE_NAME[m]}</span>`).join("")}
        <span><i class="dot"></i>Won</span><span style="color:var(--ink-faint)">Oldest → newest, metres</span></div>
    </div>`;
  }

  function drawCompare(p) {
    const c = statsFor(p, "classic"), f = statsFor(p, "frenzy");
    const rows = [
      ["Games played", (s) => DD.fmt(s.dives)],
      ["Wins", (s) => DD.fmt(s.wins)],
      ["Win rate", (s) => pct(s.wins, s.contested)],
      ["Answers", (s) => DD.fmt(s.answers)],
      ["Avg points per answer", (s) => avg(s.points, s.answers, 1)],
      ["Miss rate", (s) => pct(s.misses, s.rounds)],
      ["Leviathans found", (s) => DD.fmt(s.tiers[5])],
      ["Rare answers (Octopus+)", (s) => pct(s.tiers[3] + s.tiers[4] + s.tiers[5], s.answers)],
      ["Avg answer time", (s) => secs(s.msCount ? s.msTotal / s.msCount : 0)],
      ["Fastest answer", (s) => secs(s.fastestMs)],
      ["Avg depth per dive", (s) => (s.dives ? DD.fmt(Math.round(s.depthTotal / s.dives)) + " m" : "–")],
      ["Best dive", (s) => (s.bestDepth ? DD.fmt(s.bestDepth) + " m" : "–")],
    ];
    el.profCompare.innerHTML = `<thead><tr><th scope="col"></th><th scope="col">Classic</th><th scope="col">Frenzy</th></tr></thead>
      <tbody>${rows.map(([k, fn]) => `<tr><td>${k}</td><td>${fn(c)}</td><td>${fn(f)}</td></tr>`).join("")}</tbody>`;
  }

  function showTip(e) {
    const g = e.target.closest && e.target.closest("[data-tip]");
    if (!g) { el.profTip.hidden = true; return; }
    el.profTip.innerHTML = g.dataset.tip;
    el.profTip.hidden = false;
    const r = el.profTip.getBoundingClientRect();
    el.profTip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 12) + "px";
    el.profTip.style.top = Math.max(8, e.clientY - r.height - 12) + "px";
  }

  // ---------- wiring ----------

  // Only offer multiplayer once a backend is configured (or ?local=1 for same-device play).
  const params = new URLSearchParams(location.search);
  $("#open-mp").hidden = !(window.DEEP_DIVE_FIREBASE || params.get("local") === "1");

  $("#open-mp").addEventListener("click", () => openHome());
  el.create.addEventListener("click", createRoom);
  el.joinForm.addEventListener("submit", joinRoom);
  const hints = DD.suggester(el.form, el.input, el.suggest);
  el.form.addEventListener("submit", submit);
  el.startBtn.addEventListener("click", startDive);
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-profile]");
    if (b) openProfile(b.dataset.profile);
  });
  $("#mp-view-profile").addEventListener("click", () => { if (uid) openProfile(uid); });
  $("#prof-back").addEventListener("click", () => closeProfile());
  el.profModes.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pmode]");
    if (b && viewing) { viewing.mode = b.dataset.pmode; drawProfile(); }
  });
  el.profRecent.addEventListener("pointermove", showTip);
  el.profRecent.addEventListener("pointerleave", () => { el.profTip.hidden = true; });
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
  document.addEventListener("deepdive:menu", () => { closeProfile(true); leaveRoom(); if (offProfile) offProfile(); offProfile = null; });

  // Opening a shared room link goes straight to the join screen with the code filled in.
  if (new URLSearchParams(location.search).get("room")) openHome();
})();
