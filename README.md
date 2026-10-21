# Molise Open World

**Un mondo aperto libero e giocabile tra Palata (CB) e i paesi vicini**, costruito da zero su mappe e dati geografici aperti. Si cammina, ci si guarda intorno, si prende un'auto e si guida per la valle.

> Progetto indipendente e sperimentale, ispirato ai "fondamentali" dei giochi open-world (camminare, esplorare, guidare).
> **Non contiene e non usa nessun asset, codice o dato estratto da GTA V / Rockstar Games**: tutto il mondo è generato da fonti aperte.
>
> **Stato, comandi, limiti e prossimi passi:** [HANDOFF.md](HANDOFF.md) — il documento da leggere prima di riprendere il progetto su un'altra macchina.

**Area giocabile:** Palata · Montecilfone · Acquaviva Collecroce · Tavenna · Castelmauro (~14 × 12 km di campagna molisana)

---

## Cosa c'è dentro

- **Casa base: Palata.** Il gioco parte dal centro del paese e la mappa segna Palata come "casa".
- **Terreno 3D** a chunk (912 m) con DEM a 10 m, texture satellite fino a zoom 18 (~0,45 m/px) vicino al giocatore e normal map ricavata dal rilievo.
- **Meteo reale opzionale** (`P` → interruttore): condizioni attuali, nuvole, pioggia/neve e **sole alla posizione e ora vere**, con alba/tramonto del giorno. Aggiornamento ogni 10 minuti, fallback al pomeriggio fisso se lo spegni.
- **Radar satellite reale** in minimappa e mappa grande, con strade OSM evidenziate sopra la foto aerea (`V` per passare alla mappa vettoriale).
- **Strade** ricostruite da OpenStreetMap e drappeggiate sul rilievo (asfalto e sterrati, larghezze per tipo).
- **Paesi** con edifici estrusi dalle impronte OSM, tetti in laterizio, altezze stimate o da tag.
- **Boschi e uliveti** con alberi instanziati in modo deterministico (stesso seed → stesso paesaggio).
- **Acqua**: torrenti e specchi d'acqua.
- **Camminata** in prima/terza persona con collisioni contro gli edifici, corsa, salto.
- **Auto arcade** (Fiat Panda 4x4 stilizzata) con fisica su pendenza, off-road più lento, freno a mano, assetto a 4 punti di contatto.
- **Minimappa** e **mappa grande** dei cinque comuni, con strade, boschi e toponimi.
- **HUD** in italiano: velocità, coordinate, quota, fps, suggerimenti contestuali.
- **Offline-friendly**: i dati vettoriali e il DEM sono nel repo; solo le immagini satellite arrivano dalla rete (con fallback verde se mancano).

## Realismo: come avviciniamo la realtà

L'obiettivo è semplice: girare per Palata e dintorni e riconoscere i posti. Non c'è nessun
"reverse engineering" di GTA V: il lavoro è tutto sui **formati aperti** (tile Web Mercator,
DEM Terrarium, tag OSM) e su come renderli credibili in un motore proprio.

- **Foto aeree progressive.** Ogni chunk chiede il dettaglio giusto per la distanza:
  z18 sotto i 520 m (tetti, uliveti, muretti), z17 fino a 1,5 km, z16 fino a 2,6 km,
  z15 per l'orizzonte. Avvicinandosi, il chunk viene **riaffinato** senza essere ricostruito.
- **Rilievo che si vede.** Le normal map sono generate dal DEM (128×128 per chunk): anche
  dove la mesh è più grossolana del dato, il sole radente fa emergere crinali e fossi.
- **Luce e foschia.** Sole a 27°, ombre morbide, esposizione ACES più alta e nebbia
  spostata più lontano: il paesaggio resta leggibile invece di sparire nel grigio.
- **Post-processing.** Bloom morbido su cielo e tetti, antialiasing SMAA e OutputPass
  per tone mapping/color space corretti; si spegne da solo sui preset più leggeri.
- **Texture procedurali.** Asfalto, sterrato, intonaco e coppi sono generati a runtime
  (niente asset esterni) e aggiungono grana e giunti alle superfici viste da vicino.
- **Meteo e sole veri.** Con `Meteo reale` attivo il gioco legge le condizioni attuali da
  Open-Meteo (open source, senza chiave) e calcola il sole in locale con la formula NOAA:
  elevazione e azimut cambiano con l'ora e con il punto in cui ti trovi, quindi alba e
  tramonto sono quelli del giorno. La copertura nuvolosa diventa una cupola procedurale,
  la pioggia/neve particelle intorno alla camera, la foschia cambia con visibilità e
  precipitazioni. Il dato si aggiorna ogni 10 minuti; se la rete manca resta attivo il
  sole reale e l'ultimo meteo disponibile.
- **Audio procedurale.** Motore, rotolamento, vento, passi e uccelli sintetizzati con
  WebAudio, senza file audio; parte al primo click e si spegne con `N`.
- **Qualità scalabile.** Preset bassa/media/alta/ultra scelti in automatico, con
  resolution scaling adattivo per tenere il frame rate: il mondo gira anche su PC modesti.
- **Radar vero.** La minimappa disegna le tile Esri z17 intorno al giocatore, con le strade
  OSM in crema sopra; la mappa grande usa un mosaico z14 dell'intera area. `V` alterna
  satellite e mappa vettoriale, `M` apre la mappa grande.
- **Dati locali.** DEM e OSM sono pre-processati nel repo: il mondo parte anche senza rete,
  e le sole immagini arrivano dal provider (con fallback verde se una tile manca).

## Stack e perché

| Scelta | Motivo |
| --- | --- |
| **TypeScript + Vite** | build veloce, zero framework, tipi stretti sul motore geografico |
| **Three.js (WebGL)** | streaming di geometrie/texture, controllo fine su LOD e materiali, gira in qualsiasi browser |
| **Dati OSM + DEM pre-processati in JSON/binario** | avvio immediato, nessun database, nessun server |
| **Fisica custom (niente engine)** | per camminata e auto arcade serve poco: meno peso, più controllo, testabile |
| **Vitest** | test puri su proiezioni, heightfield, indici spaziali e modello dell'auto |

## Avvio

Requisiti: Node.js ≥ 22, un browser con WebGL2.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
```

I dati geografici sono già committati in `public/geo/`. Per rigenerarli (o cambiare area):

```bash
npm run geo              # scarica OSM + DEM e riscrive public/geo/
npm run geo -- --skip-dem
npm run geo -- --skip-osm
```

> Overpass a volte è saturo: lo script divide l'area in 16 riquadri, ruota i mirror e ritenta. Se un riquadro viene perso, rilancia `npm run geo -- --skip-dem`.

### Comandi

| Tasto | A piedi | In auto |
| --- | --- | --- |
| `W A S D` | muoviti | accelera / sterza / frena-retro |
| `Shift` | corri | — |
| `Spazio` | salta | freno a mano |
| `F` | entra in auto (se vicino) | scendi |
| `C` | prima/terza persona | — |
| `M` | mappa grande | mappa grande |
| `V` | radar satellite / mappa | radar satellite / mappa |
| `G` | qualità grafica (bassa/media/alta/ultra) | qualità grafica |
| `N` | audio on/off | audio on/off |
| `P` | impostazioni (meteo reale) | impostazioni |
| `H` | mostra/nascondi aiuto | — |
| `R` | riporta in strada | riporta in strada |
| mouse | guarda intorno (click per bloccare il puntatore) | orbita la telecamera |
| rotella | — | allontana/avvicina la telecamera |

URL utili: `?autostart=walk` e `?autostart=drive` saltano il menu (usati dallo smoke test).

## Verifica

```bash
npm test          # 42 test: proiezione, DEM, OSM, fisica auto, sole e meteo
npm run build     # typecheck + build di produzione
npm run preview   # serve dist/ su :4173
npm run smoke     # Chrome headless: carica, guida, cammina, controlla il PNG
```

Lo smoke test apre Chrome headless via CDP, verifica l'assenza di errori in console, che l'auto si muova premendo `W`, che il giocatore cammini, e analizza lo screenshot (varianza e varietà di colore) per assicurarsi che il mondo sia davvero renderizzato. Salva `smoke/shot.png`.

## Struttura

```
src/
  config.ts            costanti del mondo, proiezione lat/lon -> x/z, tuning
  geo/
    geo.ts             matematica pura (mercator, poligoni, PRNG)
    elevation.ts       heightfield DEM + campionamento bilineare
    osm.ts             tipi OSM, indici spaziali strade/edifici, collisioni
  world/
    chunks.ts          griglia dei chunk
    imagery.ts         streaming tile satellite -> texture per chunk (zoom progressivo)
    terrain.ts         mesh del terreno + LOD texture (z16/z17)
    roads.ts           nastri stradali drappeggiati + acqua
    buildings.ts       estrusione edifici + tetti
    vegetation.ts      alberi instanziati nei boschi
    surface-textures.ts texture procedurali (asfalto, sterrato, intonaco, coppi)
    weather.ts         meteo Open-Meteo, posizione reale del sole, auto-refresh
    clouds.ts          cupola di nuvole procedurali guidata dalla copertura
    precipitation.ts   pioggia e neve sintetiche intorno alla camera
    sky.ts             cielo, sole, ombre
  entities/
    player.ts          controller a piedi + avatar animato
    vehicle.ts         auto procedurale + assetto sul terreno
  sim/
    car.ts             fisica arcade pura (testabile)
  ui/
    hud.ts             HUD, impostazioni e schermate
    minimap.ts         minimappa + mappa grande (radar satellite o vettoriale)
    satellite.ts       cache tile Esri e mosaico z14 per la mappa grande
  gfx/
    post.ts            bloom + SMAA + OutputPass (post-processing opzionale)
    quality.ts         preset low/medium/high/ultra + auto-detect
  audio/
    audio.ts           WebAudio procedurale: motore, vento, passi, uccelli
  game.ts              orchestrazione, input, camera, loop
scripts/
  fetch-geodata.mjs    download e preprocessing OSM/DEM
  smoke.mjs            test end-to-end con Chrome headless
```

## Dati e licenze

- **OpenStreetMap** — strade, edifici, aree, toponimi: © OpenStreetMap contributors, licenza **ODbL 1.0**. `public/geo/osm.json` è un'opera derivata: se lo ridistribuisci, resta ODbL.
- **AWS Terrain Tiles (Terrarium)** — DEM SRTM/Copernicus/NASADEM: dati aperti, vedi [registry.opendata.aws/terrain-tiles](https://registry.opendata.aws/terrain-tiles/).
- **Esri World Imagery** — immagini satellite: © Esri, Maxar, Earthstar Geographics. Usate qui per una demo non commerciale con attribuzione. **Per una pubblicazione** usa un provider con licenza esplicita (MapTiler, Mapbox, Bing, o tile self-hosted) cambiando `ESRI_WORLD_IMAGERY` in `src/world/imagery.ts`.
- **Meteo** — Open-Meteo, dati CC BY 4.0, senza chiave API. Usato solo se attivi
  "Meteo reale"; il sole è calcolato in locale e non dipende dal servizio.
- **Codice** — MIT (vedi `LICENSE`).

GTA è un marchio dei rispettivi proprietari. Questo progetto non è affiliato né approvato da Rockstar Games e non contiene materiale del gioco.

## Idee per il prossimo giro

- traffico e pedoni con percorsi sulle strade OSM;
- audio procedurale (motore, vento, passi);
- collisioni auto più fini (OBB invece del cerchio);
- cache delle tile su IndexedDB, per rigiocare offline dopo il primo giro;
- dettaglio procedurale a terra (muretti a secco, staccionate, ulivi più vicini);
- espansione della mappa (Termoli, Larino, Montenero di Bisaccia);
- supporto mobile con joystick virtuale.

---

Fatto con calma, dati aperti e un po' di nostalgia per i giochi di una volta.
