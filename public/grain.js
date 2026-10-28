// Paper grain: draws a small speckled tile and repeats it as the page background.
// Its colour and strength come from --grain-color and --grain-strength in style.css.
(() => {
  const css = getComputedStyle(document.documentElement);
  const [r, g, b] = css.getPropertyValue('--grain-color').split(',').map(Number);
  const strength = Number(css.getPropertyValue('--grain-strength')) || 0;
  if (!strength) return;

  const SIZE = 220;
  const tile = document.createElement('canvas');
  tile.width = tile.height = SIZE;
  const ctx = tile.getContext('2d');

  // speckles
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = Math.random() * strength;
  }
  ctx.putImageData(img, 0, 0);

  // a few faint fibres
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strength / 400})`;
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * SIZE, y = Math.random() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.random() * 30 - 15, y + Math.random() * 30 - 15, x + Math.random() * 40 - 20, y + Math.random() * 40 - 20);
    ctx.stroke();
  }

  document.body.style.backgroundImage = `url(${tile.toDataURL()})`;
})();
