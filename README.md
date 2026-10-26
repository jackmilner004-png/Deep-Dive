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

## Files

| File         | Purpose |
|--------------|---------|
| `index.html` | Page markup and styles. |
| `game.js`    | Game logic, answer matching and the descent animation. |
| `prompts-specific.js` | More specific prompts (songs, films, books, sport, places, history), same format as `prompts.js`. |
| `prompts.js` | The prompt bank. Each line is `Prompt \| plankton \| krill \| seahorse \| octopus \| anglerfish \| leviathan`; answers are comma separated, alternative spellings joined with `/`. |

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
