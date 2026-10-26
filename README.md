# Deep Dive

A category word game. Each prompt names a category ("Name a cheese"); type
anything that fits before your 25 seconds of air run out. The rarer your
answer, the deeper you sink.

- Six rarity tiers: Plankton 10, Krill 25, Seahorse 40, Octopus 60,
  Anglerfish 85, Leviathan 100 (the single rarest answer for each prompt).
- Every point is 10 metres of depth; a perfect 7-prompt dive reaches 7,000 m.
- A wrong guess costs 2 seconds. In endless mode you play until you run out of
  air three times.
- 155 categories and about 7,300 answers, from broad ("Name a fruit") to
  specific ("Name a Queen song", "Name a London Underground station"), shuffled
  so prompts don't repeat until you've seen them all.

A static site — plain HTML, CSS and JavaScript, no build step.

## Multiplayer

"Play with friends" lets one player create a room and share its five-letter
code (or invite link). Everyone in the room gets the same seven prompts. After
each prompt, every player's answer is revealed together and the leaderboard
updates; the deepest diver at the end wins. Wins and multiplayer dives are kept
on each player's profile (wins only count when two or more divers play).

Multiplayer runs on Firebase (free Spark plan). Until `firebase-config.js` has a
config, the button is hidden. To switch it on:

1. Go to <https://console.firebase.google.com>, choose **Add project**, name it
   (e.g. `deep-dive`) and create it (Google Analytics isn't needed).
2. **Build → Authentication → Get started → Sign-in method → Anonymous →
   Enable → Save.** Players get a lasting anonymous id, no account needed.
3. Still in Authentication, open **Settings → Authorized domains** and add
   `jackmilner004-png.github.io`.
4. **Build → Realtime Database → Create database**, pick a location, start in
   **locked mode**. Open the **Rules** tab, replace everything with the contents
   of `database.rules.json`, then **Publish**.
5. **Project settings** (gear icon) **→ General → Your apps → Web (`</>`)**,
   register an app called `Deep Dive` (no Firebase Hosting), and copy the
   `firebaseConfig` object it shows.
6. Paste it into `firebase-config.js` as `window.DEEP_DIVE_FIREBASE = { ... };`
   and push. The config values aren't secret; the database rules control access.

To try multiplayer without Firebase, open the page with `?local=1` in two tabs
of the same browser: each tab is a separate player.

## Files

| File         | Purpose |
|--------------|---------|
| `index.html` | Page markup and styles. |
| `game.js`    | Game logic, answer matching and the descent animation. |
| `multiplayer.js` | Rooms, shared prompts, answer reveal, leaderboard and win counting. |
| `net.js` | Shared-state backends: Firebase, and a same-browser one for `?local=1`. |
| `firebase-config.js` | Your Firebase web config (empty until multiplayer is set up). |
| `database.rules.json` | Firebase Realtime Database security rules. |
| `prompts-specific.js` | More specific prompts (songs, films, books, sport, places, history), same format as `prompts.js`. |
| `prompts.js` | The prompt bank. Each line is `Prompt \| plankton \| krill \| seahorse \| octopus \| anglerfish \| leviathan`; answers are comma separated, alternative spellings joined with `/`. |

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
