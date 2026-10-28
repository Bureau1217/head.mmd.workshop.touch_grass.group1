const button = document.querySelector('.content__button');
const output = document.querySelector('.content__output');
let clicks = 0;

button.addEventListener('click', () => {
  clicks += 1;
  output.textContent = `You clicked ${clicks} time${clicks === 1 ? '' : 's'}.`;
});
