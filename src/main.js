import { Game } from './game.js';

const game = new Game(document.getElementById('app'));
game.init().then(() => game.run()).catch((err) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:absolute;top:0;left:0;z-index:99;background:#000;color:#f66;padding:12px;max-width:100%;white-space:pre-wrap';
  pre.textContent = String(err.stack || err);
  document.body.appendChild(pre);
});
