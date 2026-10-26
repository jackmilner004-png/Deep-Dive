// Google sign-in: saves multiplayer wins and solo stats to the player's account
// so progress follows them to any device. Firebase only loads for solo players
// once they've signed in (or press the button).
(function () {
  "use strict";

  const DD = window.DeepDive;
  const FLAG = "deepdive.account";            // set once this browser has signed in
  const SOLO_KEYS = ["dives", "best", "bestEndless", "prompts"];
  const boxes = Array.from(document.querySelectorAll("[data-account]"));
  const params = new URLSearchParams(location.search);
  if (!window.DEEP_DIVE_FIREBASE || params.get("local") === "1") return;

  let net = null, acct = null, busy = false, message = "";
  const esc = (s) => DD.escapeHtml(String(s || ""));
  const signedIn = () => !!acct && !acct.anonymous;
  const flagged = () => { try { return localStorage.getItem(FLAG) === "1"; } catch (e) { return false; } };
  const setFlag = (on) => { try { on ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG); } catch (e) { /* ignore */ } };

  const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

  function render() {
    const html = signedIn()
      ? `<div class="acct-row">
           ${acct.photo ? `<img src="${esc(acct.photo)}" alt="" referrerpolicy="no-referrer">` : ""}
           <div class="acct-text"><b>${esc(acct.name || "Signed in")}</b><span>${esc(acct.email)} · progress saved to your account</span></div>
           <button type="button" class="link" data-signout>Sign out</button>
         </div>`
      : `<div class="acct-row">
           <div class="acct-text"><b>Save your progress</b><span>Sign in with Google to keep your wins and stats on any device.</span></div>
           <button type="button" class="google" data-signin ${busy ? "disabled" : ""}>${GOOGLE_G}${busy ? "Signing in…" : "Sign in with Google"}</button>
         </div>`;
    boxes.forEach((box) => {
      box.hidden = false;
      box.innerHTML = html + (message ? `<p class="acct-msg">${esc(message)}</p>` : "");
    });
  }

  async function connect() {
    if (!net) net = await DeepDiveNet.connect();
    acct = net && net.account ? net.account() : null;
    return net;
  }

  // Solo stats live in this browser; keep the best of local and cloud in both.
  async function syncSolo() {
    if (!signedIn()) return;
    try {
      const local = DD.getStats();
      const cloud = (await net.get(`players/${acct.uid}/solo`)) || {};
      const merged = {};
      SOLO_KEYS.forEach((k) => { merged[k] = Math.max(local[k] || 0, cloud[k] || 0); });
      if (SOLO_KEYS.some((k) => merged[k] !== (local[k] || 0))) DD.setStats(merged);
      if (SOLO_KEYS.some((k) => merged[k] !== (cloud[k] || 0))) await net.set(`players/${acct.uid}/solo`, merged);
    } catch (e) {
      console.warn("Deep Dive: couldn't sync solo stats", e);
    }
  }

  function errorText(e) {
    const code = (e && e.code) || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
    if (code === "auth/popup-blocked") return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
    if (code === "auth/operation-not-allowed") return "Google sign-in isn't switched on for this game yet.";
    if (code === "auth/unauthorized-domain") return "Sign-in isn't allowed from this web address yet.";
    if (code === "auth/network-request-failed") return "Couldn't reach Google. Check your connection and try again.";
    return "Sign-in didn't work. Please try again.";
  }

  async function signIn() {
    if (busy) return;
    busy = true; message = ""; render();
    try {
      await connect();
      if (!net) throw new Error("not configured");
      const before = acct;
      const old = before && before.anonymous ? await net.get(`players/${before.uid}`) : null;
      const res = await net.signInWithGoogle();
      acct = net.account();
      setFlag(true);
      // This Google account already had a player: add this browser's wins to it.
      if (res.switchedFrom && old && (old.wins || old.dives)) {
        await net.transaction(`players/${acct.uid}`, (p) => {
          p = p || {};
          return Object.assign({}, p, {
            name: p.name || old.name || "",
            wins: (p.wins || 0) + (old.wins || 0),
            dives: (p.dives || 0) + (old.dives || 0),
          });
        });
      }
      await syncSolo();
      if (res.switchedFrom) { location.reload(); return; }
    } catch (e) {
      message = errorText(e);
    }
    busy = false;
    render();
  }

  async function signOut() {
    try { await connect(); await net.signOut(); } catch (e) { /* reload anyway */ }
    setFlag(false);
    location.reload();
  }

  boxes.forEach((box) => box.addEventListener("click", (e) => {
    if (e.target.closest("[data-signin]")) signIn();
    if (e.target.closest("[data-signout]")) signOut();
  }));
  document.addEventListener("deepdive:stats", syncSolo);

  render();
  // Returning signed-in players reconnect straight away so their stats load.
  if (flagged()) {
    connect().then(() => {
      if (!signedIn()) setFlag(false);
      render();
      return syncSolo();
    }).catch(() => {});
  }
})();
