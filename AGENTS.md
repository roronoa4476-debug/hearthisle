# Working on this project

Browser board game (Koolkatan) built with plain HTML, CSS and JavaScript modules plus a dependency-free Node server. Run `npm run dev` (port 5174) and `npm test`.

- Keep `public/js/rules.js` pure: no DOM, no timers, no `Math.random` without an injectable `rng`. Every action returns a new state, or the same object when the move is not allowed.
- Keep artwork out of logic. Art files are referenced only in `public/css/art.css`.
- The view builds elements with DOM APIs (no `innerHTML`) because the server sends a strict Content-Security-Policy.
- The look is a strictly 2D, top-down, premium wooden tabletop. No 3D, perspective or tilt. Animations are flat and short: cards moving between the board, hands, players and the bank, small pops and banners, all skipped for people who prefer reduced motion.
- Animations and sounds come from game events (`emit()` in `public/js/rules.js`, played by `public/js/effects.js`), not from guessing at state changes. The two exceptions are display-only: the points-coin pop (it includes your own hidden points) and the turn-timer tick. Anything private in an event (a drawn development card, a stolen resource) must be hidden per seat in `eventsFor()` in `server/rooms.mjs`.
- Use original names and art only. Do not add trademarked game names or copied artwork.
- Add or update tests in `test/` when changing rules.
- `public/js/predict.js` shows a player's own certain moves before the server confirms them. Only predict moves that depend on nothing hidden, and keep it matching `act()` in `server/rooms.mjs`; `test/predict.test.mjs` checks the two agree. End Turn is held back when the next player could win with point cards this browser can't see.
- `view.js` patches the page instead of rebuilding it. A button whose handler depends on data must show that data in its attributes or text, otherwise an unchanged-looking button keeps its old handler. Text boxes are never replaced while someone types.
- Rules never change `g.log` or `g.events` in place (`log()` and `emit()` build new arrays): states share them instead of copying them on every move.
