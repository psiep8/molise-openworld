import './style.css';
import { Game } from './game';

const canvas = document.getElementById('scene');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('canvas #scene non trovato');
}

const game = new Game(canvas);
void game.init();

// Comodo dalla console: __molise.stop() etc. non serve, ma i diagnostici sì.
declare global {
  interface Window {
    moliseGame?: Game;
  }
}
window.moliseGame = game;
