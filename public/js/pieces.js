// Hand-drawn wooden pieces as inline SVG, tinted per player.
// Artwork only: no game rules here. Built with DOM APIs (CSP-safe).

const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// Engraved player symbols, drawn in a 10x10 box centred on 0,0.
const MARKS = {
  circle: () => svg('circle', { r: 3.4 }),
  diamond: () => svg('path', { d: 'M0-4.2L4.2 0 0 4.2-4.2 0Z' }),
  triangle: () => svg('path', { d: 'M0-4.3L4.3 3.4H-4.3Z' }),
  square: () => svg('rect', { x: -3.3, y: -3.3, width: 6.6, height: 6.6, rx: 0.6 }),
  star: () => svg('path', { d: 'M0-4.6L1.3-1.5 4.5-1.4 2-0.6 2.8 3.9 0 2.1-2.8 3.9-2-0.6-4.5-1.4-1.3-1.5Z' }),
  cross: () => svg('path', { d: 'M-1.4-4.4H1.4V-1.4H4.4V1.4H1.4V4.4H-1.4V1.4H-4.4V-1.4H-1.4Z' }),
};

// The outlines the wood grain is clipped to, defined once for the whole page.
// (Fresh ids per drawing made every redraw of the build buttons look like a
// change, so the buttons were rebuilt on each update.)
const SETTLEMENT = 'M4 21L20 7 36 21V41H4Z';
const CITY = 'M3 43V20L13 9 23 20V25L40 25 50 16 60 25V43Z';
let defined = false;
function clip(id) {
  if (!defined && globalThis.document?.body) {
    defined = true;
    document.body.append(svg('svg', { class: 'svg-defs', 'aria-hidden': 'true', width: 0, height: 0 },
      svg('defs', {},
        svg('clipPath', { id: 'clip-settlement' }, svg('path', { d: SETTLEMENT })),
        svg('clipPath', { id: 'clip-city' }, svg('path', { d: CITY })),
        svg('clipPath', { id: 'clip-road' }, svg('rect', { x: 1, y: 1, width: 58, height: 10, rx: 2.4 })),
      )));
  }
  return id;
}

/** Fine wood-grain overlay, clipped to a shape. */
function grain(id, w, h) {
  const lines = [];
  for (let i = 0; i < 7; i++) {
    const y = (h / 7) * (i + 0.5);
    const a = (i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.4);
    lines.push(svg('path', { d: `M-2 ${y}C${w * 0.3} ${y + a} ${w * 0.6} ${y - a} ${w + 2} ${y + a * 0.5}` }));
  }
  return svg('g', { 'clip-path': `url(#${id})`, stroke: '#000', 'stroke-width': 0.45, fill: 'none', opacity: 0.16 }, lines);
}

export function playerMark(player, size = 16) {
  const light = player.light;
  return svg('svg', { viewBox: '-6 -6 12 12', width: size, height: size, class: 'mark', 'aria-hidden': 'true' },
    svg('circle', { r: 5.6, fill: player.color, stroke: player.edge, 'stroke-width': 0.9 }),
    svg('g', { fill: light ? player.edge : '#ffffff', transform: 'scale(0.82)' }, MARKS[player.mark]()),
  );
}

export function settlementArt(player) {
  const id = clip('clip-settlement');
  const body = SETTLEMENT;
  return svg('svg', { viewBox: '0 0 40 44', class: 'piece-art', 'aria-hidden': 'true' },
    svg('rect', { x: 27, y: 6, width: 5, height: 10, fill: player.color, stroke: player.edge, 'stroke-width': 1.3 }),
    svg('rect', { x: 27, y: 6, width: 5, height: 2, fill: '#000', opacity: 0.2 }),
    svg('path', { d: body, fill: player.color }),
    svg('path', { d: 'M20 7L36 21V41H20Z', fill: '#000', opacity: 0.14 }),
    grain(id, 40, 44),
    svg('path', { d: 'M2.5 22L20 6.5 37.5 22', fill: 'none', stroke: '#000', 'stroke-width': 2.4, opacity: 0.22, 'stroke-linejoin': 'round' }),
    svg('path', { d: 'M5.5 21L20 8.3', fill: 'none', stroke: '#fff', 'stroke-width': 1.1, opacity: 0.55, 'stroke-linecap': 'round' }),
    svg('rect', { x: 9, y: 25, width: 7, height: 6.5, rx: 0.8, fill: '#fff4cf', stroke: player.edge, 'stroke-width': 1 }),
    svg('path', { d: 'M12.5 25V31.5M9 28.2H16', stroke: player.edge, 'stroke-width': 0.8 }),
    svg('path', { d: 'M22.5 41V30.5a3.5 3.5 0 0 1 7 0V41Z', fill: '#000', opacity: 0.38 }),
    svg('circle', { cx: 28, cy: 35.6, r: 0.7, fill: '#fff', opacity: 0.8 }),
    svg('path', { d: body, fill: 'none', stroke: player.edge, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
    svg('g', { transform: 'translate(20 16) scale(0.62)', fill: player.light ? player.edge : '#fff', opacity: 0.9 }, MARKS[player.mark]()),
  );
}

export function cityArt(player) {
  const id = clip('clip-city');
  const outline = CITY;
  return svg('svg', { viewBox: '0 0 62 46', class: 'piece-art', 'aria-hidden': 'true' },
    svg('path', { d: outline, fill: player.color }),
    svg('path', { d: 'M13 9L23 20V43H13ZM50 16L60 25V43H50Z', fill: '#000', opacity: 0.14 }),
    grain(id, 62, 46),
    svg('path', { d: 'M3 25H60', stroke: player.edge, 'stroke-width': 1, opacity: 0.6 }),
    svg('path', { d: 'M4.5 19.5L13 10.2M24.5 25.2H39.5M41.5 24.2L50 17.2', fill: 'none', stroke: '#fff', 'stroke-width': 1.1, opacity: 0.55, 'stroke-linecap': 'round' }),
    svg('rect', { x: 9.5, y: 15.5, width: 7, height: 6, rx: 3, fill: '#fff4cf', stroke: player.edge, 'stroke-width': 0.9 }),
    svg('rect', { x: 9.5, y: 29, width: 7, height: 6, rx: 0.8, fill: '#fff4cf', stroke: player.edge, 'stroke-width': 0.9 }),
    svg('rect', { x: 27, y: 29, width: 6, height: 5.5, rx: 0.8, fill: '#fff4cf', stroke: player.edge, 'stroke-width': 0.9 }),
    svg('rect', { x: 46, y: 29, width: 6, height: 5.5, rx: 0.8, fill: '#fff4cf', stroke: player.edge, 'stroke-width': 0.9 }),
    svg('path', { d: 'M36.5 43V36.5a3 3 0 0 1 6 0V43Z', fill: '#000', opacity: 0.38 }),
    svg('path', { d: 'M13 9V2M13 2.2L19 4 13 5.8', fill: player.color, stroke: player.edge, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
    svg('path', { d: outline, fill: 'none', stroke: player.edge, 'stroke-width': 1.7, 'stroke-linejoin': 'round' }),
    svg('g', { transform: 'translate(13 25.6) scale(0.55)', fill: player.light ? player.edge : '#fff', opacity: 0.9 }, MARKS[player.mark]()),
  );
}

export function roadArt(player) {
  const id = clip('clip-road');
  return svg('svg', { viewBox: '0 0 60 12', preserveAspectRatio: 'none', class: 'piece-art', 'aria-hidden': 'true' },
    svg('rect', { x: 1, y: 1, width: 58, height: 10, rx: 2.4, fill: player.color }),
    grain(id, 60, 12),
    svg('rect', { x: 1, y: 6.5, width: 58, height: 4.5, fill: '#000', opacity: 0.14, 'clip-path': `url(#${id})` }),
    svg('path', { d: 'M4 3H56', stroke: '#fff', 'stroke-width': 1, opacity: 0.5, 'stroke-linecap': 'round' }),
    svg('rect', { x: 1, y: 1, width: 58, height: 10, rx: 2.4, fill: 'none', stroke: player.edge, 'stroke-width': 1.4 }),
  );
}

export function robberArt() {
  return svg('svg', { viewBox: '0 0 30 48', class: 'piece-art', 'aria-hidden': 'true' },
    svg('ellipse', { cx: 16, cy: 45.5, rx: 12, ry: 2.4, fill: '#000', opacity: 0.3 }),
    svg('path', { d: 'M4 45C4 34 7 24 10 19H20C23 24 26 34 26 45Z', fill: '#3b3a44', stroke: '#14131a', 'stroke-width': 1.3 }),
    svg('path', { d: 'M15 19H20C23 24 26 34 26 45H17C17 34 16 25 15 19Z', fill: '#000', opacity: 0.25 }),
    svg('circle', { cx: 15, cy: 12, r: 8.5, fill: '#4a4954', stroke: '#14131a', 'stroke-width': 1.3 }),
    svg('path', { d: 'M9 10a7 7 0 0 1 7-6', stroke: '#fff', 'stroke-width': 1.3, fill: 'none', opacity: 0.45, 'stroke-linecap': 'round' }),
    svg('path', { d: 'M7 45C7 35 9 26 11.5 21', stroke: '#fff', 'stroke-width': 1, fill: 'none', opacity: 0.3 }),
    svg('rect', { x: 6, y: 27, width: 18, height: 3, rx: 1.2, fill: '#b8862e', stroke: '#14131a', 'stroke-width': 0.8 }),
  );
}
