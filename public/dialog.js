// Dialogue: the box under the title, where lines are written letter by letter, one after the other.
// For now it writes placeholder lines; later the real data can write its own with dialog.say('…').
//
// To remove it, delete this file, its <script> line and the .dialog line in index.html, and the
// .dialog section in style.css; nothing else depends on it.
(() => {
  //#region SETTINGS
  const START_MS = 800;  // wait before the first line
  const TYPE_MS = 45;    // ms per letter
  const PAUSE_MS = 1500; // ms between two lines
  const LINES = [        // placeholder until the real data
    'You are userblank',
    'Your area is dry',
    'You are increasing the level of dryness',
  ];
  //#endregion

  const box = document.getElementById('dialog');
  if (!box) return;

  //#region WRITING: lines wait their turn, each one is typed out, then a pause before the next
  const queue = [];
  let busy = false;
  function next() {
    busy = queue.length > 0;
    if (!busy) return;
    const text = queue.shift();
    const line = document.createElement('p');
    line.className = 'dialog__line';
    box.append(line);
    let shown = 0;
    const timer = setInterval(() => {
      line.textContent = text.slice(0, ++shown);
      if (shown < text.length) return;
      clearInterval(timer);
      setTimeout(next, PAUSE_MS);
    }, TYPE_MS);
  }
  function say(text) {
    queue.push(text);
    if (!busy) next();
  }
  //#endregion

  setTimeout(() => LINES.forEach(say), START_MS);

  // for other scripts: dialog.say('a new line') writes it after the ones already waiting
  window.dialog = { say };
})();
