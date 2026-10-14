# Koolkatan

**[Play Koolkatan](https://koolkatan-sg.onrender.com/)** — create a room and share its link with friends.

Version **0.7.1** is a clean-up for speed: phones redraw less and paint about half as much per move, the server does a move's work about 2.5 times faster and sends about 60% fewer bytes per update, abandoned games stop using the server, a phone that wakes up reconnects by itself, and a handful of small bugs are fixed. Version 0.7.0 added table animations: cards fly between the board, hands, players and the bank whenever resources are collected, paid, traded, discarded or stolen, with turn banners, award hand-overs and confetti for the winner. It also brings a wooden dice sound, smoother map zoom, people choosing colours before bots, and lighter, faster updates. Version 0.6.0 added computer players, game options, a turn timer, rematches, sound effects and a phone layout.

**A Catan-style island board game I built for the browser**, so my friends and I can play together for free.

Settle an island, roll for resources, trade with each other and the bank, build roads, settlements and cities, and race to 10 victory points. It plays by the classic base-game rules for 3–4 players and the 5–6 player extension, on a bright, hand-drawn, honey-oak tabletop.

![Koolkatan game table](docs/screenshot.png)

> Koolkatan is a fan-made hobby project inspired by the board game *Catan*. It is not affiliated with or endorsed by Catan GmbH or its publishers. All artwork, icons and pieces in this repository are original.

## What's in it

- **The full base game:** 19-tile island (30 tiles for 5–6 players), number discs, harbours, the robber, a finite bank, development cards (Knight, Road Building, Year of Plenty, Monopoly, Victory Point), Longest Road and Largest Army.
- **Correct turn flow:** snake-order opening placements, discarding half on a 7, piece limits (15 roads, 5 settlements, 4 cities), and the paired turns used for 5–6 players.
- **Trading:** bank and harbour ratios (4:1, 3:1, 2:1), plus offers between players with accept, decline and counteroffer.
- **One screen, no scrolling:** the board, your hand, the bank, players, trading and dev cards all fit at once, down to a 1280×720 laptop.
- **Map zoom:** use +/− or the mouse wheel to zoom, drag the enlarged map, and press Fit to show the full island. Keyboard controls: +/−, arrow keys, Home or 0.
- **Original art:** illustrated terrain tiles, minimal resource and development-card emblems, and wooden pieces in six colours (Red, Blue, White, Orange, Green, Purple). Each colour also has its own symbol so nobody gets mixed up. Only owned development-card types appear in your hand, with artwork, counts and descriptions visible together.
- **Bots:** play solo against computer players, or let the host add bots to fill seats. Bots place, roll, build, trade with the bank and harbours, play development cards, move the robber and answer your trade offers. They only use public information and their own hand.
- **Game options:** the host picks points to win (8, 10 or 12), a random or balanced map (no touching 6s and 8s, terrain and odds spread out), the friendly robber (it can't target players with 2 points or fewer), and a turn timer (off, 1, 1½ or 2 minutes). When the timer runs out, that turn is finished automatically.
- **Rematch:** after a win, the host starts a new island with the same players, bots and options in one click.
- **Animations:** every card that changes hands is shown moving: production from the tiles, building costs to the bank, bank and player trades, discards on a 7, steals, Monopoly and Year of Plenty, plus bought and played development cards. Your own draws and steals flip to show the card; everyone else only sees a face-down card, so nothing private leaks. Turn banners, award hand-overs, point pops and winner confetti round it off. All flat and short, and switched off for people who prefer reduced motion.
- **Instant moves:** your own moves whose result is certain (building, bank trades, ending your turn, discarding, Year of Plenty picks) appear at once instead of waiting for the server, which then confirms them. Dice, card draws, steals, Monopoly and player trades still wait for the server, because only it knows the hidden cards.
- **Sound effects:** dice, building, harvests, trades, the robber, your turn, the last seconds of the timer and the win. Generated in the browser (no sound files); the speaker button mutes them.
- **Phones:** on a narrow screen the table becomes one scrolling column, with pinch-to-zoom on the map and bigger tap targets.
- **Online rooms:** create a room, send the link, and everyone plays from their own computer or phone. Each player picks one of six colours (a colour can't be taken twice), or joins as a spectator. Refreshing the page puts you back in your seat.
- **Fair hidden hands:** the server runs the game and only ever sends you your own cards. Everyone else's hands are just counts, and private moments (the card you drew, what was stolen) are only told to the people involved.

## Play online with friends

To play alone, type your name and press **Play solo against bots**: a room opens with three bots already seated. Change the options if you like, then press **Start game**.

For solo practice, enter **`/test`** as your name and press **Create a room**. This opens a separate practice island with two passive opponents, 12 of every resource and an empty development hand. Each purchase draws one random card from the shuffled deck. The game menu has **Refill practice resources** (during an unblocked action phase) and **New practice island**. Dice, discards, placement and development-card timing still follow the normal rules. Player-to-player trade responses are not automated. Practice commands cannot grant resources in ordinary multiplayer rooms.

1. Open the game and type your name, then **Create a room**.
2. **Copy link** and send it to your friends (or tell them the 4-letter room code). When they open it, it asks their name first.
3. Everyone picks a colour. Anyone who just wants to watch picks **Just watch**.
4. The host chooses how opening settlements are placed and the game options, can press **+ Add a bot** to fill empty seats, and presses **Start game** (3–6 players). The host can also remove anyone (or any bot) from the lobby, for example a stranger who guessed the code.

**If someone leaves for good mid-game,** the host presses **Remove** next to their name (it appears once they're away). Their seat goes on autopilot: it rolls, discards on a 7, moves the robber when it must, and ends its turn, so nobody waits. Their pieces stay on the board. Any spectator can press **Take seat** to take over that colour, with its cards and buildings, and play on.

## Put it online for free (Render)

The game runs as one small Node server, which fits [Render's free plan](https://render.com/docs/free).

1. Sign in to [render.com](https://render.com) with this GitHub account.
2. Choose **New → Blueprint** and pick this repository. Render reads `render.yaml` and sets everything up.
3. When it's live, share the public address shown by Render. This project's game runs in Singapore at [koolkatan-sg.onrender.com](https://koolkatan-sg.onrender.com/) (created from `render-singapore.yaml`), about three times quicker per move from South Asia than the original Oregon server. The old address, koolkatan.onrender.com, still works: that service has `REDIRECT_TO` set and forwards every visitor, invite links included.

Free-plan notes: the server sleeps after 15 minutes with nobody connected, so the first person to open the link may wait up to a minute while it wakes. It stays awake while a game is being played, and a free scheduled GitHub job (`.github/workflows/keep-awake.yml`) visits it every 10 minutes from 08:00 to 02:00 Pakistan time, about 560 of Render's 750 free hours a month. GitHub pauses scheduled jobs in a repository with no activity for 60 days; re-enable it from the Actions tab if that happens.

**Games survive restarts.** Render can restart a free server at any time, and pushing new code restarts it too. While a game is played the server gives each player's browser a sealed backup of the game, at most every two seconds and always ending with the latest move (encrypted with a secret only the server knows, so nobody can read or edit it). If the server restarts, everyone's screen reconnects on its own and hands back its backup; the server keeps the newest one and pauses play for a few seconds until everyone is back, then the game continues from the last move. A crash in one message is logged and ignored instead of stopping the server.

## Run it on your computer

Requires [Node.js](https://nodejs.org) 22.13 or newer.

```sh
npm install
npm start
```

Open http://localhost:5174. To try several players at once, open the room link in different browsers or private windows. Friends on the same Wi-Fi can join using your computer's local IP address and port 5174.

```sh
npm test   # rule and room tests
```

## How it's built

Plain HTML, CSS and JavaScript modules with a small Node server: no frameworks. The only dependency is [`ws`](https://github.com/websockets/ws) for live connections.

| File | Job |
| --- | --- |
| `public/js/rules.js` | Every game rule as pure functions (state in, new state out). No DOM, so the same file can run on a server. |
| `public/js/geometry.js` | Hexes, corners, edges and harbours for both island sizes. |
| `public/js/view.js` | Draws the game from one seat's point of view. |
| `public/js/pieces.js` | The wooden roads, settlements, cities and robber, drawn per player colour. |
| `public/js/main.js` | Connects to the room, sends your moves, and redraws when the server updates. |
| `public/js/map-view.js` | Fits the map and handles local zoom, dragging, pinch zoom and keyboard controls. |
| `public/js/sound.js` | Synthesised sound effects (preview them all at `/sounds.html`). |
| `public/js/predict.js` | Shows your own certain moves instantly while the server confirms them. |
| `public/js/effects.js` | Turns game events into animations and sounds, each played once, in order. |
| `public/js/fx.js` | The animation pieces: flying cards, chips, banners, confetti. |
| `public/css/art.css` | The only file that points at artwork, so the art can be swapped without touching the code. |
| `public/art/` | Terrain tiles, wood, sea and paper textures, and SVG/PNG icons. |
| `server.mjs` | Serves the game and runs the WebSocket connection, with a strict content security policy. |
| `server/rooms.mjs` | Rooms, colour picking, spectators, bots, options, the turn timer, rematches, turn checks, and hiding other players' hands. |
| `server/bots.mjs` | The computer players' decisions. |
| `server/snapshots.mjs` | Sealed game backups that let a game survive a server restart. |
| `render.yaml` | Free hosting setup for Render. |
| `test/` | Rule tests with Node's built-in test runner. |

## Rules coverage

| | 3–4 players | 5–6 players |
| --- | --- | --- |
| Land tiles | 19, including 1 desert | 30, including 2 deserts |
| Number discs | 18 | 28 |
| Harbours | 9 | 11 |
| Resource supply | 19 of each | 24 of each |
| Development deck | 25 | 34 |
| Each player's pieces | 15 roads, 5 settlements, 4 cities | Same |
| Victory | 10 points on your own turn (8 or 12 as an option) | Same |

For 5–6 players, Player 1 rolls and acts, then the player three seats to their left takes an action-only turn (no rolling, no player trades).

## Roadmap

- [x] Full rules engine with tests
- [x] One-screen bright wooden interface
- [x] Online rooms: share a link, pick your colour, or spectate
- [x] Free hosting setup (Render)
- [x] Phone-sized layout
- [x] Bots, game options, turn timer, rematch and sound effects
- [ ] In-game chat
