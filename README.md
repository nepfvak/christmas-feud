# 🎄 Sleigh Says!

A multiplayer, in-browser **holiday survey game show** for classrooms and school events.
One laptop drives the big screen (projector/TV); everyone else plays on their phone, Kahoot-style.

- **Join by room code or QR**, or pick from **"Games on your network"** on the home page
- **Custom names + avatars**: 8 characters (snowman, reindeer, elf, penguin…), 8 colors, hats, extras, faces
- **The classic survey-show format** (see [How a game works](#how-a-game-works))
- **Real data**: every answer's points come from how many people actually looked it up on Wikipedia during the holidays
- **Smart answer judging**: typos, plurals, nicknames and alternate titles are accepted ("rudolf", "egg nog", "national lampoons")
- **Synthesized sound + optional voice host**: no copyrighted show audio, works offline
- **$0 to run** (no database, no API keys)

---

## Quick start (on your own computer)

You need [Node.js 20+](https://nodejs.org) installed.

```bash
npm install
npm run build
npm start
```

Open **http://localhost:3000/host** on the laptop that's connected to the projector.
The big screen shows a QR code and a 4-letter code. Players on the **same Wi-Fi** scan it (or visit the address shown) and join.

> 💡 Tip: if phones can't connect, the school network may block device-to-device traffic. Use the free hosting option below instead. It works from anywhere.

**Practise alone** with rehearsal bots (they buzz, answer, and steal):

```bash
npm run bots -- ABCD 4
```
(replace `ABCD` with your room code)

### Developing

```bash
npm run dev        # game server on :3000 + Vite hot reload on :5173 (open http://localhost:5173/host)
npm test           # answer-matcher + game-engine tests
npm run typecheck
```

---

## Hosting it for free (so anyone can join from anywhere)

The whole game is one small Node.js process, so any free Node host works.

### Option A: Render (recommended, free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/nepfvak/christmas-feud)

1. Push this folder to a GitHub repository (or click the button above for this one).
2. Go to [render.com](https://render.com) → **New → Blueprint** → pick your repo. It reads `render.yaml` automatically.
   (Or **New → Web Service** with build command `npm ci && npm run build` and start command `npm start`.)
3. You get a URL like `https://sleigh-says.onrender.com`. Open `/host` on it.

⚠️ Free Render services **sleep after 15 minutes of no visitors** and take ~1 minute to wake.
**Open the site 5 minutes before your event** and it will stay awake while you play.

### Option B: Fly.io / Railway / any VPS
Anything that can run `npm ci && npm run build && npm start` and allows WebSockets works. Set `PORT` if your host requires it.

### Why this stack?
| Piece | Choice | Why |
|---|---|---|
| Realtime | **Socket.IO** | Auto-reconnects when phones lock; falls back to HTTP long-polling on school networks that block WebSockets |
| Server | **Node + Express** (in-memory rooms) | No database to pay for or configure; one process serves the site and the game |
| Client | **React + Vite + TypeScript** | Fast, typed, tiny production bundle (~110 KB gzipped) |
| Art | SVG avatars + one generated stage backdrop | Crisp at any size, no asset pipeline |
| Audio | Web Audio API synthesis | No sound files and no copyright issues; the theme is *Jingle Bells* (public domain) |

---

## How a game works

The rules follow the classic TV survey format, re-themed for the holidays:

1. **Face-off.** One player from each team gets a **BUZZ** button. The first to buzz answers.
   The **#1 answer** wins control instantly; otherwise the other player answers and the **higher-ranked** answer wins.
   If both miss, the next pair of players steps up.
2. **Play or pass.** The face-off winner chooses whether their team plays the board or passes it to the other team.
3. **Play the board.** Teammates answer one at a time, in turn, on their own phones (20 seconds each).
   A wrong answer or running out of time earns a **lump of coal** (a strike). Repeating an answer that's already up is free; just try again.
4. **Steal.** After **3 lumps of coal**, the other team huddles and their captain gets **one** guess.
   Right = they steal the whole stocking. Wrong = the original team keeps it.
5. **Rounds.** Round 1 and 2 are single points, Round 3 is **double**, Round 4 is **triple**.
   First team to the target score (300 by default) wins. If nobody gets there, a **Sudden Death** round decides it: only the #1 answer counts, triple value.
6. **Snowball Sprint** (bonus round). Two players from the winning team answer 5 rapid-fire questions:
   20 seconds for player 1, 25 seconds for player 2 (who must look away and **can't repeat** player 1's answers).
   **200 combined points wins.**

### Host controls
- **Space / Enter**: advance (reveal remaining answers, next round…)
- **F**: fullscreen · **M**: mute
- **☰ menu → Judge's override**: reveal an answer manually, undo a strike, award a face-off, skip a round
- **📱 Phone remote**: scan a private QR to see *every answer* on your own phone and judge from anywhere in the room (like the host's cue cards)
- **Voice**: the browser reads each question aloud (toggle in the menu)

In the lobby you can rename teams, click a player to move them to the other team, shuffle teams, remove players, and choose the target score.

---

## Where the survey answers come from

Real game shows survey 100 people. We use something anyone can verify: **what millions of people actually looked up during the holidays.**

`npm run questions` rebuilds `data/questions.json` from three free public APIs, no key needed:

1. **MediaWiki API**: resolves each answer's Wikipedia article (following redirects) and finds its Wikidata ID.
2. **Wikimedia Pageviews API**: monthly human pageviews (bots excluded) for **2023–2025**.
3. **Wikidata API**: official alternate names, which become extra accepted spellings.

**Scoring:** for each answer we measure its **holiday attention**: December pageviews minus that article's *typical month* (median of Feb–Oct).
This rewards things people look up *because it's the holidays* (eggnog, poinsettias, Home Alone) rather than things that are just always popular (basketball, coffee).
The numbers are then turned into a 100-person "survey": a documented damping curve (a real survey flattens extremes compared to raw web traffic), then the top 8 answers share 92 of the 100 responses and the long tail shares the rest, just like the "other" bucket in a real survey.
These two settings are calibrated so a 7-answer board totals about 88 points and two strong Snowball Sprint players can just reach 200.
The data source is printed on the game board, and the raw pageview counts are stored with every answer.

### Adding your own questions
Edit `data/question-bank.ts`. Each answer just needs a label and its Wikipedia article title(s):

```ts
{
  id: "ornament",
  prompt: "Name something you hang on a Christmas tree.",
  short: "Something on a tree",
  candidates: [
    c("Lights", "Christmas lights", ["string lights"]),
    c("Tinsel", "Tinsel"),
    // aim for 10+ candidates so the board has 7 and the Snowball Sprint has extras
  ],
},
```
Then run `npm run questions`. It warns you about any title it can't find.

---

## Project layout

```
server/        game server: rooms, rules engine (room.ts), HTTP + sockets (index.ts)
shared/        code used by both sides: types, answer matcher, avatar options
client/        React app: Home, Host (big screen), Player (phone), Remote (host's phone)
data/          question-bank.ts (curated) → questions.json (generated from public APIs)
scripts/       build-questions.ts (data pipeline), bots.ts (rehearsal bots)
```

Credits: stage backdrop generated with Scenario (GPT Image). Fonts: Fredoka & Nunito (SIL Open Font License).
This is an original game. It uses the familiar survey-show *format*, with its own name, art, sound and branding.
