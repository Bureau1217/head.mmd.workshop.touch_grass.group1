// Notices: what this page tells the server for the news, and the news lines about the ring spiral's words.
//   - where the visitor joins from (userPlace in userdata.js), so the server can announce "joined from…"
//   - whether they are blowing on the fire (the microphone or the arrow keys, leaf.js), while a fire burns:
//     the server makes it feed the fire or add humidity, and puts it in the news (server.js)
//     a humid visitor's blowing also adds humidity to the sky (sky.js)
//   - '"word" is burning' when the fire reaches a word of the spiral (pile.js), and '"word" is saved' for
//     the words it had not reached when it goes out
//   - saving a word (Memory): when the server says so ('save': two humid visitors blowing together, or one
//     blowing twice quickly), the word the fire is on never burns, sparkles (trunk.js) and is in the news
//   - the end: when this page's spiral has burnt ('spiralburnt', pile.js) the server is told and stops the
//     fire for everyone ('burnt'); once the saved words have flown away ('memoryflown'), the news thanks them
// Needs userdata.js, main.js (socket, addNews) and fire.js loaded before it; leaf.js and pile.js too.
//
// To remove it, delete this file and its <script> line in index.html; the server then announces visitors
// without their place and nobody's blowing reaches the fire.
(() => {
  if (typeof socket === 'undefined' || typeof addNews !== 'function') return;

  //#region SETTINGS
  const WORD_MIN = 4;     // shortest word worth a news line, in letters
  const WORD_NEWS_S = 5;  // at most one '"word" is burning' every this many seconds
  const SAVED_WORDS = 3;  // words named as saved when the fire goes out: the closest to where it stopped
  const BLOW_CHECK_MS = 200;
  const BLOW_DRY = 40;    // humidity (%) under which blowing feeds the fire instead (as in server.js)
  //#endregion

  const burning = () => typeof fireBurning !== 'undefined' && fireBurning; // fire.js

  //#region PLACE: sent once it is known, and again after a reconnection (the server then has a new socket)
  function sendPlace() {
    if (typeof userPlace === 'undefined' || userPlace.status !== 'loaded' || !socket.connected) return;
    socket.emit('place', { city: userPlace.city, country: userPlace.country });
  }
  if (typeof placeFound !== 'undefined') placeFound.then(sendPlace);
  socket.on('welcome', () => setTimeout(sendPlace, 0)); // after main.js has said hello
  //#endregion

  //#region BLOWING: on and off, only while a fire burns
  let sentBlow = false;
  setInterval(() => {
    const on = burning() && !!(window.leaf && window.leaf.blowing);
    if (on === sentBlow || !socket.connected) return;
    sentBlow = on;
    socket.emit('blow', on);
    // a humid visitor's blow adds humidity to the sky (the dry ones feed the fire, server.js)
    const dry = typeof userHumidity !== 'undefined' && Number.isFinite(userHumidity) && userHumidity < BLOW_DRY;
    if (on && !dry && window.sky && window.sky.addHumidity) window.sky.addHumidity();
  }, BLOW_CHECK_MS);
  socket.on('connect', () => { sentBlow = false; });
  //#endregion

  //#region WORDS: the spiral burns from its outer end (the end of the text) towards the centre (its start)
  let words = null, next = 0, lastNews = 0;
  // the words that show on the spiral, the last one first, as the fire meets them
  function findWords(text, n) {
    const found = [];
    const re = new RegExp(`[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{${WORD_MIN - 1},}`, 'g');
    for (let m; (m = re.exec(text)) && m.index < n;) found.push({ word: m[0], start: m.index, end: m.index + m[0].length - 1 });
    return found.reverse();
  }
  // the first character the fire has not reached yet (it has a slightly ragged edge, up to 8 characters)
  const edgeOf = r => r.n - 1 - r.front;

  setInterval(() => {
    const r = window.pile && window.pile.rings && window.pile.rings();
    if (!r || !burning()) return;
    if (!words) words = findWords(r.text, r.n);
    let reached = null;
    while (next < words.length && words[next].end >= edgeOf(r)) {
      if (!words[next].kept) reached = words[next];
      next++;
    }
    if (reached && Date.now() - lastNews >= WORD_NEWS_S * 1000) {
      lastNews = Date.now();
      addNews(`"${reached.word}" is burning`);
    }
  }, 250);

  // when the fire goes out, the words closest to where it stopped are saved
  window.addEventListener('fireout', () => {
    const r = window.pile && window.pile.rings && window.pile.rings();
    if (!r || (window.pile.ended && window.pile.ended())) return; // the spiral burnt: nothing more is saved
    const all = words || findWords(r.text, r.n);
    const saved = all.filter(w => !w.kept && w.end < edgeOf(r) - 8).slice(0, SAVED_WORDS).reverse();
    for (const w of saved) addNews(`"${w.word}" is saved`);
  });
  //#endregion

  //#region THE END: the spiral has burnt here, or somewhere else first (the server says 'burnt')
  window.addEventListener('spiralburnt', () => { if (socket.connected) socket.emit('burnt'); });
  socket.on('burnt', () => { if (window.pile && window.pile.end) window.pile.end(); });
  // the share of the spiral's words that were saved
  window.addEventListener('memoryflown', () => {
    const r = window.pile && window.pile.rings && window.pile.rings();
    const all = words || (r ? findWords(r.text, r.n) : []);
    const percent = all.length ? Math.round(100 * all.filter(w => w.kept).length / all.length) : 0;
    addNews(`Thank you, you saved ${percent}% of the forest memory`);
  });
  //#endregion

  //#region SAVING A WORD: the one the fire is on (or the next it will reach), kept intact on the spiral
  socket.on('save', () => {
    const r = window.pile && window.pile.rings && window.pile.rings();
    // before the spiral catches (its first seconds), the first word it will reach
    const text = r ? r.text : window.trunk && window.trunk.rings && window.trunk.rings.textContent;
    const n = r ? r.n : window.trunk && window.trunk.ringChars;
    if (!text || !n || !window.pile.keep) return;
    if (!words) words = findWords(text, n);
    const edge = r ? edgeOf(r) : n - 1;
    const w = words.find(x => !x.kept && x.start <= edge + 8);
    if (!w) return;
    w.kept = true;
    window.pile.keep(w.start, w.end);
    if (window.trunk.sparkle) window.trunk.sparkle(w.start, w.end);
    addNews(`"${w.word}" is saved`);
  });
  //#endregion
})();
