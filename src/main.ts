import './style.css';
import { Game } from './game';

// Comodo dalla console: `moliseGame` espone la partita e i diagnostici.
declare global {
  interface Window {
    moliseGame?: Game;
  }
}

const canvas = document.getElementById('scene');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('canvas #scene non trovato');
}

/**
 * Messaggio leggibile al posto del mondo quando la macchina non può proprio
 * disegnarlo. Serve per i PC molto vecchi e per i browser con l'accelerazione
 * hardware disattivata: era il caso in cui la pagina restava nera senza dire
 * niente. Il gioco non prova a partire in WebGL1: three 0.186 chiede WebGL2.
 */
function showUnsupported(reason: string): void {
  const host = document.getElementById('loading');
  const title = document.getElementById('loading-text') ?? host;
  if (host) host.classList.remove('hidden');
  if (title) {
    title.innerHTML =
      '<strong>Questo PC non riesce ad aprire WebGL2.</strong><br />' +
      'Il gioco richiede una GPU con WebGL2 attivo: aggiorna i driver della scheda video, ' +
      'attiva l\'accelerazione hardware nel browser oppure prova Chrome/Edge/Firefox aggiornati.<br />' +
      `<small>${reason}</small>`;
  }
  const bar = document.getElementById('loading-bar');
  if (bar) bar.style.width = '100%';
}

let webgl2 = false;
try {
  const probe = document.createElement('canvas');
  webgl2 = Boolean(probe.getContext('webgl2'));
  probe.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
} catch {
  webgl2 = false;
}

if (!webgl2) {
  showUnsupported('Contesto WebGL2 non disponibile.');
} else {
  try {
    const game = new Game(canvas);
    void game.init();
    window.moliseGame = game;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showUnsupported(message);
    console.error('avvio impossibile', error);
  }
}
