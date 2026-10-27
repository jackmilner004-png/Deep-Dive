# Deep Dive

A category word game. Each prompt names a category ("Name a cheese"); type
anything that fits before your 25 seconds of air run out. The rarer your
answer, the deeper you sink.

- Six rarity tiers: Plankton 10, Krill 25, Seahorse 40, Octopus 60,
  Anglerfish 85, Leviathan 100 (the single rarest answer for each prompt).
- Every point is 10 metres of depth; a perfect 7-prompt dive reaches 7,000 m.
- Guess as many times as you like until the timer runs out. In endless mode you
  play until you run out of air three times.
- 516 categories and about 25,000 answers, from broad ("Name a fruit") to
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
| `prompts-extra.js` | Fourth batch: 25 categories built from Wikidata lists plus 125 written by hand. |
| `prompts-r5.js` | Fifth batch: 24 categories checked against Wikidata lists, 7 Pokémon types from PokéAPI, and 58 written by hand. |
| `prompts-more.js` | Third batch of prompts (nature, places, people, entertainment, food, everyday, sport, words), same format. |
| `prompts-specific.js` | More specific prompts (songs, films, books, sport, places, history), same format as `prompts.js`. |
| `prompts.js` | The prompt bank. Each line is `Prompt \| plankton \| krill \| seahorse \| octopus \| anglerfish \| leviathan`; answers are comma separated, alternative spellings joined with `/`. |

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
