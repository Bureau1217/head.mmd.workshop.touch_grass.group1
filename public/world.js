// World: a canvas bigger than the screen. Each visitor sees part of it and can move around
// with the arrow keys. See world-steps.md for the plan.
//
// To switch it off, set WORLD_ON to false. To remove it completely, delete this file and its
// <script> line in index.html; nothing else depends on it.
const WORLD_ON = true;

(() => {
  if (!WORLD_ON) return;

  //#region SETTINGS
  const WORLD_W = 5000;   // world size in world units (the same for every screen)
  const WORLD_H = 5000;
  const GRID = 250;       // spacing of the guide grid, only there to see the movement
  const KEY_STEP = 60;    // how far one arrow key press moves the camera
  //#endregion

  //#region CANVAS: fills the screen behind the news panel, sharp on high-density screens
  const canvas = document.createElement('canvas');
  canvas.className = 'world';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let screenW = 0, screenH = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    screenW = window.innerWidth;
    screenH = window.innerHeight;
    canvas.width = Math.round(screenW * dpr);
    canvas.height = Math.round(screenH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    moveCamera(0, 0);
  }
  //#endregion

  //#region CAMERA: the top-left corner of the screen, in world coordinates; starts in the middle
  const camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 };
  let centred = false;

  // world position -> screen position, and back (for clicks)
  const toScreen = (x, y) => ({ x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom });
  const toWorld = (x, y) => ({ x: x / camera.zoom + camera.x, y: y / camera.zoom + camera.y });

  // moves by dx, dy screen pixels, without leaving the world
  function moveCamera(dx, dy) {
    if (!centred) { camera.x -= screenW / 2 / camera.zoom; camera.y -= screenH / 2 / camera.zoom; centred = true; }
    const viewW = screenW / camera.zoom, viewH = screenH / camera.zoom;
    camera.x = Math.min(Math.max(0, camera.x + dx / camera.zoom), Math.max(0, WORLD_W - viewW));
    camera.y = Math.min(Math.max(0, camera.y + dy / camera.zoom), Math.max(0, WORLD_H - viewH));
    draw(); // right away, so the grid moves in the same frame as everything else
  }
  //#endregion

  //#region MOVING AROUND: arrow keys
  window.addEventListener('keydown', e => {
    const step = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[e.key];
    if (!step) return;
    e.preventDefault();
    if (window.leaf) return; // the leaf (leaf.js) moves the camera; moving it here too made everything jump for a frame
    moveCamera(...step);
  });
  //#endregion

  //#region DRAWING: only when something changed, at most once per frame
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim();
  const inkSoft = css.getPropertyValue('--ink-soft').trim();

  function draw() {
    ctx.clearRect(0, 0, screenW, screenH);
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y); // from here on, draw in world coordinates

    // guide grid, only the lines in view
    const left = Math.floor(camera.x / GRID) * GRID, top = Math.floor(camera.y / GRID) * GRID;
    const right = camera.x + screenW / camera.zoom, bottom = camera.y + screenH / camera.zoom;
    ctx.strokeStyle = inkSoft;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();
    for (let x = left; x <= right; x += GRID) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
    for (let y = top; y <= bottom; y += GRID) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // world edge
    ctx.strokeStyle = ink;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    // things in the world get drawn here, at their own x, y

    ctx.restore();
  }
  //#endregion

  window.addEventListener('resize', resize);
  resize();

  // for other scripts: where the camera is, and how to convert between world and screen
  window.world = { WORLD_W, WORLD_H, camera, toScreen, toWorld, moveCamera, requestDraw };
})();
