# HANDOFF — Molise Open World

> Documento di passaggio di consegne. Ultimo aggiornamento: **21 ottobre 2026**.
> Leggilo per intero prima di toccare il codice: contiene stato, vincoli, comandi,
> criteri di qualità e prossimi passi con criteri di accettazione.

---

## 1. Obiettivo del progetto

Un **open-world giocabile nel browser** ambientato a **Palata (CB)** e nei quattro
paesi vicini (Montecilfone, Acquaviva Collecroce, Tavenna, Castelmauro), costruito
**solo su dati aperti** (OpenStreetMap + DEM). Si cammina e si guida, si esplora la
campagna molisana, e la mappa deve sembrare **il più possibile il posto vero**.

Direzione artistica richiesta dal proprietario:

- grafica **eccellente, da videogioco importante** (non uguale a GTA V, ma vicina);
- deve girare **su tutti i PC**, quindi qualità scalabile e fallback;
- **Palata è la casa**: spawn, etichetta e punto di riferimento;
- niente espansione della mappa senza richiesta esplicita;
- **nessun asset, codice o dato estratto da GTA V / Rockstar**: il "reverse" è solo
  sui formati geografici aperti (tile Mercator, DEM Terrarium, tag OSM).

Repo privata: <https://github.com/psiep8/molise-openworld> (branch `main`).
Stack: TypeScript + Vite + Three.js (WebGL2), Vitest, nessun framework UI.

---

## 2. Stato attuale in una schermata

| Area | Stato | Note |
| --- | --- | --- |
| Dati OSM | ✅ completi | 1.090 strade, 2.193 edifici, 1.337 aree, 96 corsi d'acqua |
| DEM | ✅ | griglia 10 m, `heights.bin` Int16 in decimetri |
| Terreno | ✅ | chunk 912 m, 96 segmenti, streaming raggio 3,1 km |
| Satellite | ✅ | z18 ≤520 m, z17 ≤1,5 km, z16 ≤2,6 km, z15 oltre |
| Normal map | ✅ | 128×128 per chunk, generata dal DEM |
| Strade | ✅ | nastri drappeggiati + texture procedurale asfalto/sterrato |
| Edifici | ✅ base | estrusione + tetto piatto con sporto + intonaco/coppi procedurali |
| Vegetazione | ✅ base | alberi instanziati deterministici, max 7000 |
| Acqua | ✅ base | nastri torrenti + poligoni laghi |
| Radar / mappa | ✅ | satellite Esri z17 + overlay OSM, mosaico z14 per mappa grande |
| Post-processing | ✅ nuovo | bloom + SMAA + OutputPass, disattivabile |
| Qualità | ✅ nuovo | preset low/medium/high/ultra + resolution scaling adattivo |
| Audio | ✅ nuovo | WebAudio procedurale: motore, rotolamento, vento, passi, uccelli |
| Fisica auto | ✅ | modello bicycle puro, testato |
| Traffico/pedoni | ❌ | non implementati |
| Cache tile offline | ❌ | solo cache HTTP del browser |
| Smoke test | ⚠️ | script aggiornato ma **non ancora eseguito** sulle ultime modifiche |

Ultime verifiche fatte su questa macchina: `npm test` 33/33 ✅,
`npm run build` ✅, controllo statico dello spawn auto/giocatore sui dati reali ✅.
Lo smoke e2e è stato rimandato su richiesta: dipende dal download delle tile e la
rete di questa macchina è instabile/bloccata (DNS).

---

## 3. Avvio e comandi

Requisiti: **Node ≥ 22**, browser con WebGL2.

```bash
npm ci                 # installa le dipendenze (package-lock committato)
npm run dev            # http://127.0.0.1:5173
npm run build          # tsc --noEmit + vite build
npm run preview        # serve dist/ su http://127.0.0.1:4173
npm test               # 33 test puri (geo, DEM, OSM, fisica auto)
npm run smoke          # e2e Chrome headless; richiede `npm run preview` attivo
npm run geo            # riscarica OSM + DEM (rete! attenzione ai DNS)
npm run geo -- --skip-dem
npm run geo -- --skip-osm
```

URL utili:

- `?autostart=walk` / `?autostart=drive` saltano il menu (usati dallo smoke);
- `?quality=low|medium|high|ultra` forza il preset grafico;
- il preset scelto con `G` viene salvato in `localStorage` (`molise.quality`).

---

## 4. Comandi di gioco

| Tasto | A piedi | In auto |
| --- | --- | --- |
| `W A S D` | muoviti | accelera / sterza / frena-retro |
| `Shift` | corri | — |
| `Spazio` | salta | freno a mano |
| `F` | entra in auto (se vicino) | scendi |
| `C` | prima/terza persona | — |
| `M` | mappa grande | mappa grande |
| `V` | radar satellite / vettoriale | idem |
| `G` | cicla qualità grafica | idem |
| `N` | audio on/off | idem |
| `H` | mostra/nascondi aiuto | — |
| `R` | riporta in strada | riporta in strada |

---

## 5. Mappa dei file

```
src/
  config.ts              bbox, proiezione lat/lon→x/z, HOME/START, colori, tuning
  game.ts                orchestrazione, input, camera, loop, qualità, audio, HUD
  main.ts                bootstrap
  geo/
    geo.ts               mercator, poligoni, PRNG, hash
    elevation.ts         heightfield + campionamento bilineare, loadHeightfield
    osm.ts               decode osm.json compatto, indici strade/edifici, collisioni
  world/
    chunks.ts            griglia chunk
    imagery.ts           tile provider Esri, zoom per distanza, composizione texture
    terrain.ts           mesh + streaming + upgrade zoom + normal map
    roads.ts             nastri stradali/acqua, UV e texture procedurali
    buildings.ts         estrusione edifici, tetto, materiali
    vegetation.ts        alberi instanziati deterministici
    sky.ts               Sky + sole/ombre/nebbia
    surface-textures.ts  asfalto, sterrato, intonaco, coppi (canvas)
  entities/
    player.ts            controller a piedi + avatar
    vehicle.ts           auto procedurale + assetto 4 punti
  sim/car.ts             fisica arcade pura (testata)
  ui/
    hud.ts               HUD, toast, schermate
    minimap.ts           radar satellite/vettoriale + mappa grande
    satellite.ts         cache tile Esri z17 + mosaico z14
  gfx/
    post.ts              EffectComposer: bloom + SMAA + OutputPass
    quality.ts           preset grafici, auto-detect, persistenza
  audio/audio.ts         WebAudio procedurale
public/geo/              heights.json, heights.bin, osm.json (committati)
scripts/fetch-geodata.mjs  rigenerazione dati (Overpass + Terrarium)
scripts/smoke.mjs          e2e Chrome headless via CDP
tests/                     test Vitest puri
docs/ARCHITECTURE.md       spiegazione tecnica del motore
```

---

## 6. Dati geografici: formato e rigenerazione

- `public/geo/osm.json` è **compatto**: le chiavi sono abbreviate (`t` tipo, `c`
  coordinate `[lat, lon][]`, `n` nome, `h` altezza, `k` kind). Il decode avviene in
  `loadOsm()` dentro `src/geo/osm.ts`; **non** assumere `points`/`width` nel JSON su disco.
- `public/geo/heights.json` + `heights.bin`: griglia regolare da 10 m, Int16
  little-endian in **decimetri**, row-major, origine in `originX/originZ`.
- BBox e proiezione in `src/config.ts` devono restare identici a
  `scripts/fetch-geodata.mjs`, altrimenti DEM e OSM si disallineano.
- `npm run geo` usa 16 riquadri Overpass con mirror e retry; su reti bloccate può
  fallire. In quel caso **non rigenerare**: i dati attuali sono già completi e committati.
- Licenze: OSM ODbL 1.0; DEM AWS Terrain Tiles (SRTM/Copernicus/NASADEM);
  immagini Esri World Imagery solo demo non commerciale con attribuzione. Per una
  pubblicazione pubblica serve un provider con licenza esplicita (MapTiler/Mapbox/Bing
  o tile self-hosted): cambiare `ESRI_WORLD_IMAGERY` in `src/world/imagery.ts`.

---

## 7. Grafica: come è organizzata

1. **Renderer**: WebGL2, ACES Filmic, esposizione 0.92, shadow map PCF soft.
2. **PostPipeline** (`src/gfx/post.ts`): RenderPass → UnrealBloom (soglia 0.82) →
   SMAA → OutputPass. Se disabilitato, `renderer.render` diretto.
3. **Qualità** (`src/gfx/quality.ts`): preset con `pixelRatio`, `shadowMapSize`,
   `post`, `bloom`, `maxSatelliteZoom`. Auto-detect da core/memoria/mobile.
4. **Resolution scaling** (`game.ts`): ogni 2 s, se fps < 34 scende fino a 0.65×;
   se fps > 56 risale. `renderScale` è esposto in `window.__molise`.
5. **Terreno**: geometria 96×96 per chunk, normal map 128² dal DEM, texture
   progressive z15→z18 con sostituzione a runtime.
6. **Superfici**: texture canvas deterministiche (asfalto, sterrato, intonaco,
   coppi) moltiplicate dai vertex color; UV delle strade in metri (1 unità = 6 m).
7. **Atmosfera**: Sky di Three.js, sole a 27°/azimut 238°, nebbia lineare 1100–4200 m.

**Prestazioni attese** (da verificare): 60 fps a 1080p su GPU tipo GTX 1060/RX 580
con preset `high`; ≥ 30 fps su iGPU recenti con `low`/`medium`. Se non regge,
i primi interruttori sono: `maxSatelliteZoom`, `post`, `shadowMapSize`, `renderScale`.

---

## 8. Diagnostica e debug

In console, ogni frame:

```js
window.__molise
// { ready, running, mode, chunks, textured, detailed, fps, x, z, speed, keys,
//   tileErrors, quality, renderScale, errors }
```

- `chunks` = chunk terreno attivi; `textured` = con texture; `detailed` = z17+.
- `tileErrors` cresce se Esri non risponde (rete/DNS/licenza): il gioco resta in
  piedi con fallback verde e mappa vettoriale.
- `errors` raccoglie errori runtime e promise rejection.
- `scripts/smoke.mjs` usa questi campi e attende fino a 12 s le texture prima di
  controllare `textured/detailed`.

Screenshot smoke: `smoke/shot.png` (ignorato da git). Il profilo Chrome è in
`smoke/profile` (ignorato).

---

## 9. Limiti noti / cose da NON rompere

- **La rete può essere bloccata**: non rendere il boot dipendente da tile esterne.
  OSM + DEM devono restare locali e il fallback verde/mappa vettoriale deve funzionare.
- **Licenza immagini**: non cambiare provider senza aggiornare README e attribuzioni;
  non usare tile Mapbox/Google senza chiave e licenza.
- **Palata è la casa**: non spostare lo spawn altrove e mantieni l'etichetta "casa".
- **Mappa**: non allargare il bbox senza richiesta esplicita; i cinque comuni sono
  il perimetro attuale.
- **Determinismo**: vegetazione e colori usano `mulberry32`/`hashInt` con seed fisso.
  Non introdurre `Math.random()` nella generazione del mondo (l'audio può usarlo).
- **Nessun asset Rockstar/GTA**: vietato importare modelli, texture, audio o codice
  del gioco. Il progetto è indipendente e non affiliato.
- **Audio**: parte solo dopo un gesto utente; non creare `AudioContext` all'avvio.
- **Post-processing**: non assumere che sia attivo; testa anche il percorso diretto.
- **Mobile**: non è ancora ottimizzato; i preset `low` sono il punto di partenza.

---

## 10. Prossimi passi consigliati (in ordine)

### P0 — Verifica reale (prima di aggiungere features)

1. Avviare `npm run preview` e poi `npm run smoke` su una macchina con rete.
   - deve passare: nessun errore console, auto che si muove, giocatore che cammina,
     `textured ≥ 1`, `detailed ≥ 1`, screenshot non piatto;
   - se fallisce per tile: distinguere errori di rete (`tileErrors`) da regressioni.
2. Controllare a occhio in Chrome: bloom non troppo forte, normal map non invertita,
   texture strade non stirate, radar leggibile, audio non clipping.
3. Misurare fps a 1080p con preset high e con low (DevTools performance + `fps` in
   `window.__molise`). Se < 50 fps su GPU media, ridurre prima `renderScale`/bloom.

### P1 — Qualità grafica “quasi AAA”

- **Tetti veri**: falde inclinate con colmo (hip/gable) invece del tetto piatto;
  ombre corrette e coppi con UV allineate. Criterio: in terza persona i tetti di
  Palata si leggono come tetti, non come lastre.
- **Facciate**: finestre/porte procedurali (texture per edificio o shader) e
  variazione di altezza/piano; evitare l'effetto “scatole colorate”.
- **Vegetazione**: LOD (billboard oltre ~150 m), vento nei vertici, macchie di
  vegetazione bassa vicino al giocatore; mantenere 2 draw call per gli alberi.
- **Terreno**: micro-rilievo e triplanar detail texture vicino alla camera;
  evitare il “plastico” quando si cammina.
- **Acqua**: normale animata e riflesso cielo sui torrenti.
- **Atmosfera**: ombre più lunghe all'alba/tramonto, god rays semplici (screen-space),
  esposizione adattiva.

### P2 — Mondi vivi

- Traffico e pedoni su percorsi OSM (solo strade paved, spawn fuori vista).
- Audio: clacson, ghiaia, uccelli per bioma, riverbero in piazza.
- Meteo leggero (foschia/pioggia) con shader e suoni.

### P3 — Robustezza / distribuzione

- Cache tile su **IndexedDB** (LRU, quota) per rigiocare offline.
- Prefetch/cancel delle tile in base alla direzione di marcia.
- Supporto mobile (joystick virtuale, preset low, DPR limitato).
- Gamepad API e rimappatura tasti.
- Provider immagini con licenza per pubblicazione; attribuzioni dinamiche.

---

## 11. Criteri di accettazione per il prossimo AI

- `npm run build` e `npm test` devono passare **prima** di ogni commit.
- Nessuna regressione su: spawn a Palata, auto che parte, radar, `V`, `M`, `G`, `N`.
- Il mondo deve caricarsi anche con rete assente (fallback verde + mappa vettoriale).
- Non introdurre asset binari pesanti o non licenziati.
- Commit piccoli, messaggi in italiano, niente segreti/token nel repo.
- Se aggiungi una feature grafica, aggiungi anche il modo di spegnerla o un preset
  che la escluda, e documenta l'impatto su fps/memoria.
- Aggiorna questo file e `docs/ARCHITECTURE.md` quando cambi l'architettura.

---

## 12. Checklist di ripresa su una nuova macchina

```bash
git clone https://github.com/psiep8/molise-openworld.git
cd molise-openworld
npm ci
npm test
npm run build
npm run dev
```

Poi:

1. apri `http://127.0.0.1:5173/?autostart=walk&quality=high`;
2. verifica `window.__molise.ready === true` e `errors` vuoto;
3. controlla `textured`/`detailed` e `tileErrors` dopo ~10 s;
4. fai un giro a piedi a Palata e uno in auto verso Montecilfone;
5. esegui `npm run smoke` con `npm run preview` attivo;
6. aggiorna questo handoff con data, commit, esito test e nuove priorità.

Buon lavoro. La cosa più importante: **il posto deve sembrare vero**.
