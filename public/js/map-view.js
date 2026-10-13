// Local map camera only. Tile coordinates and game moves stay unchanged.
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 2.5;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function fitMap(width, height, padding, ratio) {
  const availableWidth = Math.max(1, width - padding - 4);
  const availableHeight = Math.max(1, height - padding - 4);
  // Use a little of the sea margin to make the island itself more readable.
  const boardWidth = Math.min(availableWidth, availableHeight * ratio) * 1.04;
  return {
    boardWidth, boardHeight: boardWidth / ratio,
    frameWidth: Math.min(Math.max(1, width - 4), boardWidth + padding + 120),
    frameHeight: Math.max(1, height - 4),
  };
}

export function clampView(view, size) {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  const maxX = Math.max(0, (size.boardWidth * zoom - size.width) / 2);
  const maxY = Math.max(0, (size.boardHeight * zoom - size.height) / 2);
  return { zoom, x: zoom === MIN_ZOOM ? 0 : clamp(view.x, -maxX, maxX), y: zoom === MIN_ZOOM ? 0 : clamp(view.y, -maxY, maxY) };
}

export function zoomAt(view, zoom, anchor, size) {
  zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = zoom / view.zoom;
  return clampView({ zoom, x: anchor.x - (anchor.x - view.x) * scale, y: anchor.y - (anchor.y - view.y) * scale }, size);
}

export function createMapView({ table, frame, viewport, board, zoomIn, zoomOut, reset, label }) {
  let view = { zoom: MIN_ZOOM, x: 0, y: 0 };
  let size = { width: 1, height: 1, boardWidth: 1, boardHeight: 1 };
  let currentKey;
  let drag = null;
  const touches = new Map(); // pointerId -> {x, y}, for two-finger pinch zoom
  let pinch = null;

  function paint() {
    board.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    label.textContent = `${Math.round(view.zoom * 100)}%`;
    zoomIn.disabled = view.zoom >= MAX_ZOOM;
    zoomOut.disabled = view.zoom <= MIN_ZOOM;
    viewport.classList.toggle('zoomed', view.zoom > MIN_ZOOM);
  }
  function zoomTo(zoom, anchor = { x: 0, y: 0 }) {
    view = zoomAt(view, zoom, anchor, size);
    paint();
  }
  function fit() {
    view = { zoom: MIN_ZOOM, x: 0, y: 0 };
    paint();
  }
  zoomIn.addEventListener('click', () => zoomTo(view.zoom + 0.2));
  zoomOut.addEventListener('click', () => zoomTo(view.zoom - 0.2));
  reset.addEventListener('click', fit);
  viewport.addEventListener('wheel', (event) => {
    if (event.target.closest('.map-controls') || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
    zoomTo(view.zoom * Math.exp(-delta * 0.0015), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
  }, { passive: false });
  viewport.addEventListener('keydown', (event) => {
    if (event.target !== viewport) return;
    if (event.key === '+' || event.key === '=') zoomTo(view.zoom + 0.2);
    else if (event.key === '-') zoomTo(view.zoom - 0.2);
    else if (event.key === 'Home' || event.key === '0') fit();
    else if (view.zoom > MIN_ZOOM && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const dx = event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
      const dy = event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0;
      view = clampView({ ...view, x: view.x + dx, y: view.y + dy }, size);
      paint();
    } else return;
    event.preventDefault();
  });
  const center = (rect, a, b) => ({ x: (a.x + b.x) / 2 - rect.left - rect.width / 2, y: (a.y + b.y) / 2 - rect.top - rect.height / 2 });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') {
      // A first finger starts fresh: forget touches whose lift never reached the map.
      if (event.isPrimary) { touches.clear(); pinch = null; }
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: view.zoom };
        if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
        drag = null; // two fingers zoom instead of dragging
        viewport.classList.remove('dragging');
        return;
      }
    }
    // Placement targets retain their normal click/touch behavior.
    if (drag || view.zoom <= MIN_ZOOM || event.button !== 0 || event.target.closest('button')) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', (event) => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      zoomTo(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), center(viewport.getBoundingClientRect(), a, b));
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    view = clampView({ ...view, x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY }, size);
    viewport.classList.add('dragging');
    paint();
  });
  function endDrag(event) {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    viewport.classList.remove('dragging');
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('lostpointercapture', endDrag);

  return {
    resize(ratio, key) {
      const padding = parseFloat(getComputedStyle(frame).paddingLeft) * 2;
      const fitted = fitMap(table.clientWidth, table.clientHeight, padding, ratio);
      frame.style.width = `${fitted.frameWidth}px`;
      frame.style.height = `${fitted.frameHeight}px`;
      board.style.width = `${fitted.boardWidth}px`;
      board.style.height = `${fitted.boardHeight}px`;
      size = { ...fitted, width: viewport.clientWidth, height: viewport.clientHeight };
      if (key !== currentKey) {
        currentKey = key;
        view = { zoom: MIN_ZOOM, x: 0, y: 0 };
      }
      view = clampView(view, size);
      paint();
    },
  };
}
