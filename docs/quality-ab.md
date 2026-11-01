# Alta vs Ultra — perché Ultra sembrava meno reale

Indagine F13. Domanda: «Media/Alta sembrano più reali di Ultra, perché?»

## Metodo

1. Lettura di `src/gfx/quality.ts`, `src/gfx/post.ts` e della degradazione
   adattiva in `src/game.ts` (`tunePerformance` / `degrade`).
2. Matrice A/B riproducibile: `scripts/quality-ab.mjs` cattura la stessa posa
   del banco prova (`?bench=1`) a parità di ora e meteo, e riporta **una sola**
   variabile di Ultra al valore di Alta.
3. Ogni variabile è isolabile anche a mano con `?ab=chiave:valore`
   (`pr`, `bloom`, `ssao`, `shadow`, `sharpen`, `trees`, `shrubs`, `grass`,
   `landcover`, `landcoverRadius`), più `?hour=22` per le pose notturne.

## Cause trovate (in ordine di impatto)

| # | Variabile | Alta | Ultra (prima) | Effetto |
| --- | --- | --- | --- | --- |
| 1 | `bloom` | 0,012 | **0,020** | +67% di alone: cielo e riflessi si allargano, i colori si slavano. È la causa principale della sensazione «meno reale». |
| 2 | `sharpen` | 0,28 | **0,35** | Unsharp più forte su un'immagine già a 2× di pixel ratio: bordi "croccanti" e alone chiaro/scuro sui contorni. |
| 3 | degradazione adattiva | gradini normali | **ombre spente al primo gradino**, poi `renderScaleFloor` a 0,5 | Con fps sotto 30 Ultra spegneva le ombre (la cosa che più dà profondità) e scendeva a 1,0× effettivo: risultato più piatto e più sfocato di Alta, in silenzio. |
| 4 | SSAO | kernel 0,6 / max 0,08 | identico | Non è una causa: il pass è lo stesso. |
| 5 | `shadowMapSize` | 2048 | 4096 | Nessun artefatto intrinseco a 4096: costa, ma non peggiora l'immagine. |

## Correzioni applicate

- **Post-processing allineato**: Ultra usa `bloom: 0,012` e `sharpen: 0,28`,
  gli stessi valori di Alta. Ultra resta più definito per `pixelRatio: 2`,
  shadow map 4K e più vegetazione, senza cambiare la taratura del look.
- **Degradazione non distruttiva su Ultra** (`degradeUltra` in `src/game.ts`):
  1. mappa ombre 4K → 2K (aspetto praticamente invariato);
  2. raggio del terreno a 2,2 km (streaming, non estetica);
  3. solo come ultima risorsa, risoluzione a 0,85× — mai 0,5×.
  Ogni gradino lo dice nell'HUD; ombre e post-processing non vengono mai spenti.
- **Diagnostica**: `__molise.degraded` e la riga HUD continuano a riportare la
  degradazione, così non è più silenziosa.

## Matrice A/B

Eseguire con un dev server attivo:

```bash
npm run dev
node scripts/quality-ab.mjs --url http://127.0.0.1:5173
```

Lo script produce `captures/quality-ab/*.png` e riscrive questo file con la
tabella compilata (fps letti da `window.__molise.fps`).

| caso | preset | override | fps | immagine | cosa isola |
| --- | --- | --- | ---: | --- | --- |
| alta | high | — | — | — | riferimento |
| ultra | ultra | — | — | — | preset pieno |
| ultra-pr-1.5 | ultra | `pr:1.5` | — | — | risoluzione |
| ultra-bloom-0.012 | ultra | `bloom:0.012` | — | — | alone del bloom |
| ultra-no-ssao | ultra | `ssao:0` | — | — | occlusione ambientale |
| ultra-shadow-2048 | ultra | `shadow:2048` | — | — | mappa ombre |
| ultra-trees-20000 | ultra | `trees:20000` | — | — | densità alberi |
| ultra-landcover-1900 | ultra | `landcoverRadius:1900` | — | — | copertura del suolo |
| ultra-sharpen-0.28 | ultra | `sharpen:0.28` | — | — | nitidezza |

> **Stato di questa macchina**: la matrice **non è stata eseguita** perché non
> c'è Chrome/Chromium disponibile nell'ambiente. Lo script è pronto e si ferma
> con un messaggio esplicito (`exit 2`) invece di generare un report vuoto.
> La verifica statica (`tsc --noEmit`) passa; le catture e i confronti a occhio
> vanno fatti su una macchina con browser.

## Risultato atteso

Ultra non deve mai risultare più sfocato o più slavato di Alta: a parità di
posa e meteo deve mostrare gli stessi colori e la stessa taratura del bloom,
con in più solo risoluzione e densità. Se gli fps non reggono, Ultra lo dice
nell'HUD e scende di risoluzione fino a 0,85×, mai a 0,5×.
