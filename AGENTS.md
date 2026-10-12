# Working on this project

Browser board game (Hearthisle) built with plain HTML, CSS and JavaScript modules plus a dependency-free Node server. Run `npm run dev` (port 5174) and `npm test`.

- Keep `public/js/rules.js` pure: no DOM, no timers, no `Math.random` without an injectable `rng`. Every action returns a new state, or the same object when the move is not allowed.
- Keep artwork out of logic. Art files are referenced only in `public/css/art.css`.
- The view builds elements with DOM APIs (no `innerHTML`) because the server sends a strict Content-Security-Policy.
- The look is a strictly 2D, top-down, premium wooden tabletop. No 3D, perspective or tilt. Animation stays minimal: hover, press, dice tumble, piece placement, small notifications.
- Use original names and art only. Do not add trademarked game names or copied artwork.
- Add or update tests in `test/` when changing rules.
