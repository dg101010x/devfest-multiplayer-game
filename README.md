# DRIFT

**Telestrations × Pictionary, live — where the chat *is* the chain.**

Built at GDG Devfest Bay Area 2026 · theme: *Make it multiplayer*

---

## The idea

Telestrations is silent and asynchronous — you pass a sketchbook and nobody talks. Pictionary is live and loud, but it has no chain. Bolting a chat onto Telestrations gives you a chat nobody uses.

DRIFT fuses them by making the chat **mechanically load-bearing**:

1. One player draws a secret word. Strokes stream to every device as they're drawn.
2. Everyone else guesses in live chat, Pictionary-style.
3. **The first correct guess becomes the next round's prompt**, and the pencil rotates.
4. **If nobody gets it, the last wrong guess carries forward anyway** — a bad guess poisons the chain.
5. The reveal replays the whole drift: seed word → sketch → guess → sketch → final word.

That step 4 is the whole game. Wrong answers aren't failure states, they're the engine.

## Google tech used

| Product | What it actually does here |
|---|---|
| **Cloud Firestore** | Realtime game state, append-only stroke batches, chat |
| **Firebase** | Project + anonymous auth (no sign-up friction at a jam) |
| **Gemini API** | Four distinct jobs, below |
| **Google AI Studio** | Where the Gemini key comes from |

### Gemini does four real jobs

Not a chatbot bolted to the side — each one is load-bearing:

1. **Semantic judge.** "puppy" counts for *dog*; "space man" counts for *astronaut*. String matching fundamentally can't do this, and it's what makes guessing feel fair instead of pedantic. Exact matches and typos (Levenshtein ≤1) short-circuit locally with **no network call**, so the common case stays instant and only genuinely ambiguous guesses cost a round trip.
2. **Prompt generator.** Themed, drawable, funnier than a static word list.
3. **GEM, the AI player.** Guesses in chat alongside humans — and deliberately guesses *wrong and funny* most of the time, only landing the real answer ~20% of the time after 25s. A two-player room still feels like a party.
4. **Reveal roast.** Narrates how far the chain drifted. Roasts the drift, never the drawer.

Every Gemini path degrades gracefully: missing key or failed call falls back to a local word list, offline judge, and templated roast. The game never blocks on the network.

## Architecture notes

- **Vanilla JS, no build step.** Nothing to break 40 minutes into a jam.
- **Stroke batching at 60ms.** A Firestore write per *point* would be hundreds of writes and visible lag; batches are append-only docs so `onSnapshot` delivers only what's new.
- **Normalized 0..1 coordinates** with a per-point width multiplier, so a stroke drawn on a phone replays identically on a laptop and on the tiny reveal filmstrip canvases.
- **Firestore rejects nested arrays**, so points travel flat (`[x,y,w,x,y,w,…]`, stride 3) and rehydrate on read.
- **Single-writer model.** The host client drives every state transition; the drawer's client is the sole judge. Zero write races.
- **Server-timestamped `endsAt`** — every client computes remaining time locally, so no cross-device timer drift.

## Run it

```bash
cp config.example.js config.js   # then paste your Firebase + Gemini values
python3 -m http.server 8000
```

Open `localhost:8000` in two windows (one incognito = two players).

`config.js` is gitignored — **don't commit API keys to a public repo**, GitHub's scanner will revoke them and scrapers will burn your quota.

## Known tradeoffs (deliberate, jam-grade)

- Gemini key is client-side and visible in the network tab. Standard for AI Studio quickstarts; fine for a demo, not for public hosting.
- Firestore rules allow any authenticated client to write any room.
- The prompt lives in the round doc, so a determined guesser could read it in devtools. The honest fix is a server-side function; not worth it in a 30-minute build.
- No mid-round reconnect recovery — a player who drops rejoins cleanly at the next round.
