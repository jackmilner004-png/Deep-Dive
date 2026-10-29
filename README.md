# Deep Dive

A category word game. Each prompt names a category ("Name a cheese"); type
anything that fits before your 25 seconds of air run out. The rarer your
answer, the deeper you sink.

- Six rarity tiers: Plankton 10, Krill 25, Seahorse 40, Octopus 60,
  Anglerfish 85, Leviathan 100 (the single rarest answer for each prompt).
- Every point is 10 metres of depth; a perfect 7-prompt dive reaches 7,000 m.
- Guess as many times as you like until the timer runs out. In endless mode you
  play until you run out of air three times.
- Close misses get a "Did you mean …?" line under the answer box: bad
  misspellings, sound-alikes, the start of a long answer, or part of one
  ("lebowski" → The Big Lebowski, "kane" → Harry Kane). Tap it to answer with
  it, or press Tab to copy it into the box. Nothing is suggested when two
  answers are equally close, and Feeding Frenzy never suggests anything.
- 412 categories and about 45,000 answers, from broad ("Name a fruit") to
  specific ("Name a Queen song", "Name a London Underground station"), shuffled
  so prompts don't repeat until you've seen them all (multiplayer rooms draw
  from the host's shuffled order too).

A static site — plain HTML, CSS and JavaScript, no build step.

## Multiplayer

"Play with friends" lets one player create a room and share its five-letter
code (or invite link). Everyone in the room gets the same seven prompts. After
each prompt, every player's answer is revealed together and the leaderboard
updates; the deepest diver at the end wins. Wins and multiplayer dives are kept
on each player's profile (wins only count when two or more divers play).

The host picks a mode in the lobby:

- **Classic**: everyone answers every prompt; all answers are revealed together.
- **Feeding frenzy**: the question stays hidden until the timer starts, and the
  first right answer claims the round. Only that player scores, and rarer answers
  still score more. Rounds nobody claims before the timer runs out score nothing.

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

Win counts unlock animated badges in the lobby and on your profile: Glow at 5
wins, Embers at 10, Flame at 20, then each time wins double: Plasma at 40,
Aurora at 80, Prism at 160 and Dark matter from 320.

### Diver profiles

Every multiplayer dive records per-mode stats on the player (`players/<id>/stats`
and the last 30 dives in `players/<id>/history`). Open your own profile from the
multiplayer screen, or anyone's by tapping their name in the lobby or on the
end-of-dive leaderboard. It shows games, wins, win rate, answers, average points
per answer, miss rate, Leviathans found, answer speed, best and average depth,
average finishing place, answers by rarity, recent dives, and Classic vs
Feeding frenzy side by side.

The profile's **Solo** tab covers single-player dives: dives, deepest dive and
endless run, answers, average points, miss rate, Leviathans, rare answers,
answer speed, longest streak, wrong guesses per prompt, answers by rarity,
recent dives, and Dive vs Endless side by side. Open it with **Your stats** on
the start screen (no multiplayer connection needed). Solo stats are kept in the
browser (`deepdive.stats`) and copied to `players/<id>/solo` when you play
multiplayer or sign in, so lobby-mates can see them too. The recent-dives chart
for solo play is only stored on your own device.

### Google sign-in (saving progress)

Players can sign in with Google from the start screen or the multiplayer
screen. Signing in upgrades the anonymous player this browser already has, so
existing wins carry over; if the Google account already has progress elsewhere,
this browser's wins and dives are added to it. Solo stats (dives, best depths,
prompts answered) are saved to `players/<id>/solo` and merged across devices.
To switch it on:

1. **Authentication → Sign-in method → Add new provider → Google → Enable**,
   choose a support email, **Save**.
2. Republish `database.rules.json` (it allows the `solo` stats).

To try multiplayer without Firebase, open the page with `?local=1` in two tabs
of the same browser: each tab is a separate player.

## Files

| File         | Purpose |
|--------------|---------|
| `index.html` | Page markup and styles. |
| `game.js`    | Game logic, answer matching and the descent animation. |
| `account.js` | Google sign-in and syncing solo stats to the player's account. |
| `multiplayer.js` | Rooms, shared prompts, answer reveal, leaderboard and win counting. |
| `net.js` | Shared-state backends: Firebase, and a same-browser one for `?local=1`. |
| `firebase-config.js` | Your Firebase web config (empty until multiplayer is set up). |
| `database.rules.json` | Firebase Realtime Database security rules. |
| `facts.js` | A short note on each prompt's Leviathan answer, shown after the reveal. Add one when you add a prompt. |
| `prompts-extra.js` | Fourth batch: categories built from Wikidata lists plus ones written by hand. |
| `prompts-r5.js` | Fifth batch: hand-written categories (songs, TV, sport, places, food, words). |
| `prompts-more.js` | Third batch of prompts (nature, places, people, entertainment, food, everyday, sport, words), same format. |
| `prompts-specific.js` | More specific prompts (songs, films, books, sport, places, history), same format as `prompts.js`. |
| `prompts.js` | The prompt bank. Each line is `Prompt \| plankton \| krill \| seahorse \| octopus \| anglerfish \| leviathan`; answers are comma separated, alternative spellings joined with `/`. New prompts go at the end of the last file; removing or reordering prompts means bumping `BANK_VERSION` in `game.js`. |

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
