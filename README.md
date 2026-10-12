# Hearthisle

**A Catan-style island board game I built for the browser**, so my friends and I can play together for free.

Settle an island, roll for resources, trade with each other and the bank, build roads, settlements and cities, and race to 10 victory points. It plays by the classic base-game rules for 3–4 players and the 5–6 player extension, on a bright, hand-drawn, honey-oak tabletop.

![Hearthisle game table](docs/screenshot.png)

> Hearthisle is a fan-made hobby project inspired by the board game *Catan*. It is not affiliated with or endorsed by Catan GmbH or its publishers. All artwork, icons and pieces in this repository are original.

## What's in it

- **The full base game:** 19-tile island (30 tiles for 5–6 players), number discs, harbours, the robber, a finite bank, development cards (Knight, Road Building, Year of Plenty, Monopoly, Victory Point), Longest Road and Largest Army.
- **Correct turn flow:** snake-order opening placements, discarding half on a 7, piece limits (15 roads, 5 settlements, 4 cities), and the paired turns used for 5–6 players.
- **Trading:** bank and harbour ratios (4:1, 3:1, 2:1), plus offers between players with accept, decline and counteroffer.
- **One screen, no scrolling:** the board, your hand, the bank, players, trading and dev cards all fit at once, down to a 1280×720 laptop.
- **Original art:** illustrated terrain tiles, detailed resource icons, and wooden pieces in six colours (Red, Blue, White, Orange, Green, Purple). Each colour also has its own symbol so nobody gets mixed up.
- **Built for online play:** the screen always shows one player's seat (your hand, your buttons, everyone else's public info). Online rooms are the next step.

## Play it locally

Requires [Node.js](https://nodejs.org) 22.13 or newer.

```sh
npm start
```

Open http://localhost:5174, choose 3–6 players, and start. While online rooms are being built, you can test every seat on one computer: the view follows whoever has to act, or click any player on the left to sit in their seat.

```sh
npm test   # 72 rule tests
```

## How it's built

Plain HTML, CSS and JavaScript modules with a tiny Node server: no frameworks.

| File | Job |
| --- | --- |
| `public/js/rules.js` | Every game rule as pure functions (state in, new state out). No DOM, so the same file can run on a server. |
| `public/js/geometry.js` | Hexes, corners, edges and harbours for both island sizes. |
| `public/js/view.js` | Draws the game from one seat's point of view. |
| `public/js/pieces.js` | The wooden roads, settlements, cities and robber, drawn per player colour. |
| `public/js/main.js` | Holds the state, the current seat, saving and timing. |
| `public/css/art.css` | The only file that points at artwork, so the art can be swapped without touching the code. |
| `public/art/` | Terrain tiles, wood, sea and paper textures, and icons (all SVG). |
| `server.mjs` | Static server with a strict content security policy. |
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
| Victory | 10 points on your own turn | Same |

For 5–6 players, Player 1 rolls and acts, then the player three seats to their left takes an action-only turn (no rolling, no player trades).

## Roadmap

- [x] Full rules engine with tests
- [x] One-screen bright wooden interface
- [ ] Online rooms: share a link, pick your colour, or spectate
- [ ] Free hosting so friends can join from their own devices
