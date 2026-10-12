import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGeometry } from '../public/js/geometry.js';
import { fitMap, clampView, zoomAt, MIN_ZOOM, MAX_ZOOM } from '../public/js/map-view.js';

test('the wider map frame fits its area and preserves hex proportions', () => {
  for (const [width, height, padding] of [[888, 585, 20], [744, 568, 20], [480, 700, 28]]) {
    for (const players of [3, 4, 5, 6]) {
      const geo = getGeometry(players);
      const fitted = fitMap(width, height, padding, geo.width / geo.height);
      assert.ok(fitted.frameWidth <= width);
      assert.ok(fitted.frameHeight <= height);
      assert.ok(Math.abs(fitted.boardWidth / fitted.boardHeight - geo.width / geo.height) < 1e-10);
      const visibleX = (fitted.frameWidth - padding) / fitted.boardWidth * geo.width / 2;
      const visibleY = (fitted.frameHeight - padding) / fitted.boardHeight * geo.height / 2;
      for (const h of geo.hexes) {
        assert.ok(Math.abs(h.x) + Math.sqrt(3) / 2 * 1.28 < visibleX, `${players} players: shoreline fits horizontally`);
        assert.ok(Math.abs(h.y) + 1.28 < visibleY, `${players} players: shoreline fits vertically`);
      }
      for (const h of geo.harbors) {
        assert.ok(Math.abs(h.x) + 0.4 < visibleX, `${players} players: harbor fits horizontally`);
        assert.ok(Math.abs(h.y) + 0.4 < visibleY, `${players} players: harbor fits vertically`);
      }
    }
  }
});

const size = { width: 750, height: 560, boardWidth: 630, boardHeight: 584 };
test('zoom stays within its limits and Fit recenters both axes', () => {
  assert.deepEqual(clampView({ zoom: -10, x: 900, y: -900 }, size), { zoom: MIN_ZOOM, x: 0, y: 0 });
  const max = clampView({ zoom: 10, x: 0, y: 0 }, size);
  assert.equal(max.zoom, MAX_ZOOM);
  assert.deepEqual(zoomAt(max, 1, { x: 200, y: 100 }, size), { zoom: 1, x: 0, y: 0 });
});

test('mouse-wheel zoom keeps the map point under the cursor stationary', () => {
  const before = { zoom: 1.4, x: 15, y: -12 }, anchor = { x: 40, y: 80 };
  const after = zoomAt(before, 1.8, anchor, size);
  assert.ok(Math.abs((anchor.x - before.x) / before.zoom - (anchor.x - after.x) / after.zoom) < 1e-10);
  assert.ok(Math.abs((anchor.y - before.y) / before.zoom - (anchor.y - after.y) / after.zoom) < 1e-10);
  assert.deepEqual(before, { zoom: 1.4, x: 15, y: -12 });
});

test('panning stops at the map boundary and reclamps after resizing', () => {
  const view = clampView({ zoom: 2, x: 9999, y: -9999 }, size);
  assert.equal(view.x, (size.boardWidth * 2 - size.width) / 2);
  assert.equal(view.y, -(size.boardHeight * 2 - size.height) / 2);
  const resized = clampView(view, { ...size, width: 1600, height: 1300 });
  assert.ok(resized.x === 0);
  assert.ok(resized.y === 0);
});
