// Shared-state backends for multiplayer. Both expose the same small API:
//   ready() -> uid           serverNow() -> ms
//   get(path)                set(path, value)       update(path, {relPath: value})
//   on(path, cb) -> off      transaction(path, fn)  setOnDisconnect(path, value)
// Paths are slash-separated, like "rooms/ABCDE/players". A transaction's fn
// returns the new value, or undefined to leave it unchanged.
window.DeepDiveNet = (function () {
  "use strict";

  const FIREBASE_VERSION = "10.12.2";

  async function firebase(config) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
    const [{ initializeApp }, A, D] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-database.js"),
    ]);
    const app = initializeApp(config);
    const auth = A.getAuth(app);
    const db = D.getDatabase(app);
    await auth.authStateReady();
    // Anonymous sign-in gives each browser a lasting player id with no account;
    // signing in with Google upgrades that same id (see signInWithGoogle).
    if (!auth.currentUser) await A.signInAnonymously(auth);
    let offset = 0;
    D.onValue(D.ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
    const ref = (path) => D.ref(db, path);

    return {
      kind: "firebase",
      ready: async () => auth.currentUser.uid,
      account() {
        const u = auth.currentUser;
        return u && { uid: u.uid, anonymous: u.isAnonymous, name: u.displayName || "", email: u.email || "", photo: u.photoURL || "" };
      },
      // Links Google to the current anonymous player, keeping its id and progress.
      // If that Google account already has a player, signs in to it instead and
      // reports the anonymous id it came from, so its progress can be merged.
      async signInWithGoogle() {
        const provider = new A.GoogleAuthProvider();
        const before = auth.currentUser;
        try {
          if (before && before.isAnonymous) await A.linkWithPopup(before, provider);
          else await A.signInWithPopup(auth, provider);
          return { switchedFrom: null };
        } catch (e) {
          if (e.code !== "auth/credential-already-in-use") throw e;
          await A.signInWithCredential(auth, A.GoogleAuthProvider.credentialFromError(e));
          return { switchedFrom: before && before.uid };
        }
      },
      async signOut() {
        await A.signOut(auth);
        await A.signInAnonymously(auth);
      },
      serverNow: () => Date.now() + offset,
      get: async (path) => (await D.get(ref(path))).val(),
      set: (path, value) => D.set(ref(path), value),
      update: (path, values) => D.update(ref(path), values),
      on(path, cb) { return D.onValue(ref(path), (s) => cb(s.val())); },
      async transaction(path, fn) {
        const r = await D.runTransaction(ref(path), (cur) => fn(cur));
        return { committed: r.committed, value: r.snapshot.val() };
      },
      setOnDisconnect: (path, value) => D.onDisconnect(ref(path)).set(value),
    };
  }

  // Same-device backend: every tab of this browser shares one store through
  // localStorage, with a BroadcastChannel to announce changes. Each tab is its
  // own player. Used for testing and hot-seat play (?local=1).
  function local() {
    const KEY = "deepdive.localdb";
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("deepdive-local") : null;
    const listeners = new Set();
    let uid;
    try { uid = sessionStorage.getItem("deepdive.localuid"); } catch (e) { /* ignore */ }
    if (!uid) {
      uid = "local-" + Math.random().toString(36).slice(2, 10);
      try { sessionStorage.setItem("deepdive.localuid", uid); } catch (e) { /* ignore */ }
    }

    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    const parts = (path) => path.split("/").filter(Boolean);
    const at = (root, path) => parts(path).reduce((o, k) => (o == null ? null : o[k] ?? null), root);
    const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
    function put(root, path, value) {
      const ks = parts(path);
      let o = root;
      ks.slice(0, -1).forEach((k) => { if (typeof o[k] !== "object" || o[k] === null) o[k] = {}; o = o[k]; });
      if (value === null || value === undefined) delete o[ks[ks.length - 1]];
      else o[ks[ks.length - 1]] = clone(value);
    }
    // Tabs take turns through a Web Lock, so simultaneous writes can't overwrite each other.
    const locked = (fn) => (navigator.locks
      ? navigator.locks.request("deepdive-localdb", async () => fn())
      : Promise.resolve().then(fn));
    function write(mutate) {
      const root = read();
      mutate(root);
      localStorage.setItem(KEY, JSON.stringify(root));
      if (channel) channel.postMessage("change");
      notify();
    }
    function notify() {
      const root = read();
      listeners.forEach((l) => {
        const v = JSON.stringify(at(root, l.path));
        if (v !== l.last) { l.last = v; l.cb(clone(at(root, l.path))); }
      });
    }
    if (channel) channel.onmessage = notify;
    window.addEventListener("storage", (e) => { if (e.key === KEY) notify(); });

    return {
      kind: "local",
      ready: async () => uid,
      serverNow: () => Date.now(),
      get: async (path) => clone(at(read(), path)),
      set: (path, value) => locked(() => write((root) => put(root, path, value))),
      update: (path, values) => locked(() => write((root) => {
        Object.entries(values).forEach(([k, v]) => put(root, path + "/" + k, v));
      })),
      on(path, cb) {
        const l = { path, cb, last: JSON.stringify(at(read(), path)) };
        listeners.add(l);
        setTimeout(() => cb(clone(at(read(), path))), 0);
        return () => listeners.delete(l);
      },
      transaction: (path, fn) => locked(() => {
        const root = read();
        const next = fn(clone(at(root, path)));
        if (next === undefined) return { committed: false, value: at(root, path) };
        write((r) => put(r, path, next));
        return { committed: true, value: next };
      }),
      setOnDisconnect: async () => {},
    };
  }

  let pending = null;
  // Resolves to a backend, or null when multiplayer isn't configured.
  function connect() {
    if (!pending) {
      const params = new URLSearchParams(location.search);
      if (params.get("local") === "1") pending = Promise.resolve(local());
      else if (window.DEEP_DIVE_FIREBASE) pending = firebase(window.DEEP_DIVE_FIREBASE);
      else pending = Promise.resolve(null);
    }
    return pending;
  }

  return { connect };
})();
