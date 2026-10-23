# HANDOFF — Molise Open World

> Documento di passaggio di consegne. Ultimo aggiornamento: **23 ottobre 2026**.
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
| Satellite | ✅ | mosaico Sentinel-2 locale per ogni chunk; tile Esri z18 ≤500 m, z17 fino a 3200 m, z16 oltre |
| Normal map | ✅ | 128×128 per chunk, generata dal DEM |
| Strade | ✅ aggiornato | asfalto scuro con mezzeria tratteggiata; **marciapiede rialzato 18 cm con cordolo a faccia verticale**, interrotto agli incroci |
| Edifici | ✅ aggiornato | estrusione + tetti a falde + **cornicione, comignolo, pluviali e balconi**; finestre incassate da normal map dedicata |
| Vegetazione | ✅ aggiornato | tronchi con corteccia PBR, chiome a card fotografiche con `alphaMap`, vento nei vertici, max 7000 alberi |
| Prati | ✅ aggiornato | 60k ciuffi istanziati, lame sottili su canvas 256 (`alphaTest`), vento; marciapiedi e cordoli restano liberi |
| Acqua | ✅ aggiornato | nastri torrenti + poligoni laghi con normali scorrevoli e materiale fisico (clearcoat) |
| Meteo reale | ✅ nuovo | Open-Meteo + sole NOAA, cupola nuvole, pioggia/neve, switch in impostazioni |
| Radar / mappa | ✅ | satellite Esri z17 + overlay OSM, mosaico z14 per mappa grande |
| Itinerario | ✅ nuovo | click sulla mappa grande → A* sulla rete OSM, km e tempi, beacon 3D |
| Post-processing | ✅ aggiornato | bloom con soglia 3,2 (non investe più il cielo) + SSAO + SMAA + OutputPass, disattivabile |
| Qualità | ✅ nuovo | preset low/medium/high/ultra + resolution scaling adattivo |
| Audio | ✅ nuovo | WebAudio procedurale: motore, rotolamento, vento, passi, uccelli |
| Fisica auto | ✅ | modello bicycle puro, testato |
| Catalogo veicoli | ✅ aggiornato | **22 modelli**: 9 preesistenti + 13 richiesti (sagome procedurali, prestazioni reali) |
| Economia virtuale | ✅ nuovo | SOLO EURO DI GIOCO: contanti + conto virtuale, acquisti atomici, storico, ATM simulato (`src/sim/economy.ts`) |
| Luoghi di Palata | ✅ nuovo | catalogo data-driven, stato di verifica esplicito, **nessuno `verified`** (`src/sim/venue-catalog.ts`) |
| Bisogni + orologio | ✅ nuovo | fame/energia/divertimento, giorno/notte, sonno a casa (`src/sim/needs.ts`) |
| Salvataggio modalità vita | ✅ nuovo | `molise.life.v1`, versionato e convalidato, autosalvataggio 30 s (`src/sim/save.ts`) |
| Interni camminabili | ⚠️ pianificato | le attività usano un pannello contestuale, non un interno 3D |
| Sandbox libero | ⚠️ pianificato | prove veicoli/outfit senza denaro: non ancora separata |
| Traffico/pedoni | ❌ | non implementati |
| Cache tile offline | ❌ | solo cache HTTP del browser |
| Smoke test | ✅ eseguito | 21/10/2026 dopo l'integrazione vita: verde, `wallet` 50.000/200.000 + `needs` + `clock 08:00` corretti |

> **Denaro di gioco (regola inderogabile).** Gli euro del gioco sono una valuta
> fittizia interna al videogioco: nessun conto, carta, IBAN o gateway reale. Le
> attività possono corrispondere a luoghi reali di Palata, ma gli acquisti sono
> **simulati** e il gioco non invia ordini o pagamenti ai locali. I luoghi marcati
> `needs-review`/`simulated` non hanno nome/posizione/prezzi verificati.

Dettagli di progetto e stato funzionalità: `docs/LIFE_SIMULATOR.md` e
`docs/ROADMAP.md`.

Ultime verifiche fatte (macchina Windows, 21/10/2026, rete disponibile):
`npm ci` ✅, `npm test` 151/151 ✅ (13 file: geo, DEM, OSM, fisica auto, routing,
tetti, sole, economia, bisogni, catalogo luoghi, salvataggio),
`npm run build` ✅, `npm run smoke` ✅ con `npm run preview` attivo — nessun errore
console, auto che avanza con `W`, giocatore che cammina, `textured`/`detailed` ≥ 1,
screenshot non piatto. Lo smoke che prima falliva (auto ferma a 0,43 m) ha rivelato
un bug vero: gli fps erano calcolati sul `dt` **limitato** a 50 ms, quindi con frame
time reale > 50 ms il gioco dichiarava sempre 20 fps e il resolution scaling adattivo
non poteva mai scattare. Ora `fps` usa il tempo reale e solo la fisica usa il `dt`
limitato; lo smoke misura lo spostamento invece di un tempo fisso, così resta valido
anche a 2 fps di rendering software (SwiftShader in headless).

**Pacchetto texture (22/10/2026).** Superfici PBR CC0 in `public/textures/`
(Poly Haven + ambientCG + `waternormals.jpg` di three.js, provenienze in
`public/textures/ATTRIBUTION.md`), caricate da `src/gfx/textures.ts` e scaricabili con
`npm run textures`. Stesse mappe su strade (asfalto/sterrato + marciapiedi e cordoli in
cemento), edifici, tetti, terreno, corteccia e foglie. `src/gfx/wind.ts` è il registro
condiviso di vento e scorrimento UV; `Game.update` chiama `updateWind(dt)`.
Verifiche di questa sessione: `npx tsc --noEmit` ✅, `npm test` 151/151 ✅,
`npx vite build` ✅, catture headless `captures/after4` (preset high, luminosità media
204 contro 173 di `captures/after3`, nessun errore riportato dallo script). La scena è
più chiara soprattutto per i marciapiedi in cemento e per l'ora reale del sole: prima di
toccare le texture, ricontrollare l'esposizione con una cattura alla stessa ora.

> **Texture e git.** `public/textures/` pesa ~28 MB: non è stata committata, in linea con
> la regola «niente asset binari pesanti». Su una macchina nuova lancia `npm run textures`
> una volta (rete necessaria); senza file il gioco resta giocabile con i colori di
> fallback.

**Velo bianco con la qualità alta (22/10/2026).** Il colpevole non erano le texture: con
`UnrealBloomPass` a soglia 1.0 il cielo finiva nel bloom e ai preset `high`/`ultra`
l'immagine si copriva di un velo bianco (confermato disattivando la pass dal vivo). Ora la
soglia è 2.2, il raggio 0.28 e le intensità sono 0.075/0.11: si accendono solo i riflessi.
Insieme: le ruote non affondano più nell'asfalto (la carrozzeria sale di 0.205 m quando è
su strada), le auto hanno volume arrotondato con cerchi a razze, le case uno zoccolo in
pietra, le strade il tratteggio di mezzeria e i marciapiedi una tinta grigia invece che
sabbia. Se ricompare un'immagine "lattea", controllare prima bloom e `toneMappingExposure`,
non i materiali.

---

## 3. Avvio e comandi

Requisiti: **Node ≥ 22**, browser con WebGL2.

```bash
npm ci                 # installa le dipendenze (package-lock committato)
npm run dev            # http://127.0.0.1:5173
npm run build          # tsc --noEmit + vite build
npm run preview        # serve dist/ su http://127.0.0.1:4173
npm test               # test Vitest puri (geo, DEM, OSM, fisica auto, routing, tetti, sole, economia, bisogni, luoghi, salvataggio)
npm run streets        # censimento foto stradali Mapillary (serve MAPILLARY_TOKEN)
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
| `E` | entra nell'attività vicina / dormi e salva a casa | — |
| `I` | portafoglio virtuale e movimenti | portafoglio virtuale e movimenti |
| `C` | prima/terza persona | — |
| `M` | mappa grande (click = itinerario) | mappa grande (click = itinerario) |
| `X` | annulla l'itinerario | annulla l'itinerario |
| `V` | radar satellite / vettoriale | idem |
| `G` | cicla qualità grafica | idem |
| `N` | audio on/off | idem |
| `P` | impostazioni / meteo reale | idem |
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
    buildings.ts         estrusione edifici, falde del tetto, materiali, UV facciata
    roof.ts              geometria pura del tetto a padiglione (con test sui dati OSM)
    vegetation.ts        alberi instanziati deterministici
    grass.ts             campo d'erba instanziato, ricostruzione a budget di frame
    ground-mask.ts       maschera locale strada/edificio/pendio per la vegetazione
    sky.ts               Sky + sole/ombre/nebbia
    surface-textures.ts  asfalto, sterrato, intonaco, coppi (canvas)
    weather.ts           meteo Open-Meteo, sole NOAA, auto-refresh 10 min
    clouds.ts            cupola nuvole procedurale (alpha map + deriva vento)
    precipitation.ts     pioggia a linee e neve a punti intorno alla camera
  entities/
    player.ts            controller a piedi + avatar
    vehicle.ts           auto procedurale + assetto 4 punti
  sim/car.ts             fisica arcade pura (testata)
  sim/routing.ts         grafo stradale da OSM + A* per l'itinerario (testato)
  sim/economy.ts         economia SOLO di gioco: contanti+conto virtuali, acquisti atomici
  sim/needs.ts           fame/energia/divertimento: calo nel tempo ed effetti
  sim/venue-catalog.ts   luoghi e attività di Palata + menu simulati, stato di verifica
  sim/save.ts            salvataggio modalità vita (versione, convalida, orologio)
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
5. **Terreno**: geometria 96×96 per chunk, normal map 128² dal DEM, mosaico
   Sentinel-2 locale come base e tile Esri z17/z16 con sostituzione a runtime.
6. **Superfici**: texture canvas deterministiche (asfalto, sterrato, intonaco,
   coppi, **facciata con finestra e persiane**) moltiplicate dai vertex color; UV
   delle strade in metri (1 unità = 6 m).
6-bis. **Edifici**: tetto a padiglione con colmo rientrato del 42% e sporto 4,5%
   (`world/roof.ts`, puro e testato). Le facciate usano un modulo di finestra ogni
   ~3,3 m in orizzontale e in verticale, con la prima fila di finestre a ~0,9 m dal
   suolo; le impronte irregolari (baricentro fuori dal poligono) ricadono sul tetto
   piatto invece di generare falde impossibili.
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
//   tileErrors, quality, renderScale, route, wallet, needs, clock, venue,
//   errorCount, weather, errors }
// weather = null oppure { enabled, loading, code, cloudCover, error }
// route = null oppure { distance, label } (itinerario attivo)
// wallet = { cash, account, total, transactions } (centesimi di euro di gioco)
// needs = { hunger, energy, fun } (0–100)
// clock = { day, minutes, label } (label es. "08:00")
// venue = nome dell'attività aperta, oppure null
```

- `chunks` = chunk terreno attivi; `textured` = con texture; `detailed` = z17+.
- `fps` è misurato sul tempo reale del frame (non sul `dt` di fisica limitato a 50 ms):
  resta veritiero anche sotto i 20 fps e il resolution scaling adattivo entra in azione.
- `tileErrors` cresce se Esri non risponde (rete/DNS/licenza): il gioco resta in
  piedi con il mosaico Sentinel locale e la mappa vettoriale.
- `errors` raccoglie errori runtime e promise rejection.
- `scripts/smoke.mjs` usa questi campi e attende fino a 12 s le texture prima di
  controllare `textured/detailed`.

Screenshot smoke: `smoke/shot.png` (ignorato da git). Il profilo Chrome è in
`smoke/profile` (ignorato).

---

## 9. Limiti noti / cose da NON rompere

- **La rete può essere bloccata**: non rendere il boot dipendente da tile esterne.
  OSM + DEM + mosaico Sentinel devono restare locali e la mappa vettoriale deve funzionare.
- **Licenza immagini**: non cambiare provider senza aggiornare README e attribuzioni;
  non usare tile Mapbox/Google senza chiave e licenza.
- **Palata è la casa**: non spostare lo spawn altrove e mantieni l'etichetta "casa".
- **Mappa**: non allargare il bbox senza richiesta esplicita; i cinque comuni sono
  il perimetro attuale.
- **Determinismo**: vegetazione e colori usano `mulberry32`/`hashInt` con seed fisso.
  Non introdurre `Math.random()` nella generazione del mondo (l'audio può usarlo).
- **Nessun asset Rockstar/GTA**: vietato importare modelli, texture, audio o codice
  del gioco. Il progetto è indipendente e non affiliato. Lo stesso vale per asset
  "estratti" da altri giochi con tool di reverse engineering: la grafica resta
  procedurale o basata su dati aperti con licenza compatibile.
- **Audio**: parte solo dopo un gesto utente; non creare `AudioContext` all'avvio.
- **Meteo**: il sole deve restare reale anche senza rete (calcolo locale). Non rendere
  il boot dipendente da Open-Meteo e non introdurre chiavi API: il servizio è no-key.
  Rispetta la licenza CC BY 4.0 e l'attribuzione nel pannello/README.
- **Post-processing**: non assumere che sia attivo; testa anche il percorso diretto.
- **Mobile**: non è ancora ottimizzato; i preset `low` sono il punto di partenza.
- **Denaro SOLO di gioco**: mai collegare l'economia a pagamenti, carte, IBAN,
  gateway, conti o API finanziarie reali. Gli acquisti sono simulati e i prezzi
  dei menu sono inventati. Non presentare un luogo `needs-review`/`simulated`
  come verificato: servono fonte, data e conferma della posizione.
- **Interni**: la modalità vita usa pannelli contestuali, non interni 3D
  camminabili. Non far credere che esistano finché non sono implementati.

---

## 10. Prossimi passi consigliati (in ordine)

### P0 — Verifica reale (prima di aggiungere features)

1. ~~Avviare `npm run preview` e poi `npm run smoke` su una macchina con rete.~~
   **Fatto il 21/10/2026 ✅** — nessun errore console, auto che si muove, giocatore
   che cammina, `textured ≥ 1`, `detailed ≥ 1`, screenshot non piatto (variance 3152,
   58 colori distinti). Resta da rifare dopo ogni modifica grossa a terrain/input.
2. Controllare a occhio in Chrome: bloom non troppo forte, normal map non invertita,
   texture strade non stirate, radar leggibile, audio non clipping.
3. Misurare fps a 1080p con preset high e con low (DevTools performance + `fps` in
   `window.__molise`). Se < 50 fps su GPU media, ridurre prima `renderScale`/bloom.
4. **Verificare i flussi della modalità vita a mano**: `E` vicino a un'attività →
   comprare in contanti e col conto (controllare che il saldo non vada mai negativo
   e che lo storico cresca), ATM simulato, `E` a casa → dormire (giorno +1, 07:00,
   energia 100), `I` per il portafoglio, e provare su strada i 22 modelli. Segnare
   qui l'esito prima di dichiarare la funzione "verificata".

### P1 — Qualità grafica “quasi AAA”

- **Facciate da foto stradali (da valutare prima di implementare)**: Mapillary e
  KartaView pubblicano immagini street-level con licenza CC BY-SA; servirebbe un
  token gratuito e, soprattutto, copertura. `npm run streets` (script
  `check-street-imagery.mjs`) fa il censimento: quante strade hanno una foto entro
  50 m. Serve `MAPILLARY_TOKEN` (gratuito, dal dashboard sviluppatori). Attenzione:
  dal 16/1/2026 l'API accetta bbox **sotto 0,01° per lato**, quindi lo script divide
  l'area in 13×19 riquadri. Se la copertura è rada (probabile in campagna molisana),
  conviene investire sulle facciate procedurali (già fatte: finestre, persiane,
  davanzali) che rendono bene anche senza foto.

- **Tetti veri**: falde inclinate con colmo (hip/gable) invece del tetto piatto;
  ombre corrette e coppi con UV allineate. Criterio: in terza persona i tetti di
  Palata si leggono come tetti, non come lastre.
- **Facciate**: finestre/porte procedurali (texture per edificio o shader) e
  variazione di altezza/piano; evitare l'effetto “scatole colorate”.
- **Vegetazione**: resta il LOD (billboard oltre ~150 m); vento e macchie d'erba
  vicino al giocatore sono fatti (`vegetation.ts`, `grass.ts`), 3 draw call per gli alberi.
- **Terreno**: micro-rilievo e triplanar detail texture vicino alla camera;
  evitare il “plastico” quando si cammina.
- **Acqua**: fatto (normali scorrevoli + materiale fisico); resta il riflesso del cielo
  a schermo intero se servirà più realismo.
- **Texture**: le mappe sono 1K; valutare 2K solo su `ultra` e un `KHR_texture_basisu`
  per la RAM video, misurando gli fps prima di alzare il dettaglio.
- **Atmosfera**: ombre più lunghe all'alba/tramonto, god rays semplici (screen-space),
  esposizione adattiva.

### P2 — Mondi vivi e meteo

- Traffico e pedoni su percorsi OSM (solo strade paved, spawn fuori vista).
- Meteo: fulmini/tuoni per i codici 95–99, accumulo neve a terra, pozzanghere,
  previsione oraria (Open-Meteo `hourly`) per far cambiare il tempo durante la sessione.
- Cache dell'ultimo meteo in `localStorage` per partire offline con l'ultimo dato.
- Audio: clacson, ghiaia, uccelli per bioma, riverbero in piazza, pioggia/vento legati al meteo.

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
- Il mondo deve caricarsi anche con rete assente (mosaico Sentinel + mappa vettoriale).
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
5. premi `M`, clicca su un paese e verifica che l'itinerario compaia con km e tempi,
   che la linea resti sulla minimappa e che `X` lo annulli;
6. premi `P`, attiva **Meteo reale**: verifica che il sole corrisponda all'ora e che
   nuvole/pioggia cambino; controlla `window.__molise.weather` e l'attribuzione
   Open-Meteo nel pannello;
7. esegui `npm run smoke` con `npm run preview` attivo (copre anche l'itinerario);
8. aggiorna questo handoff con data, commit, esito test e nuove priorità.

Buon lavoro. La cosa più importante: **il posto deve sembrare vero**.

---

## 13. Passaggio del 22 ottobre 2026 — resa visiva

### Cosa era rotto (causa, non sintomo)

- **Velo bianco ai preset alti.** `UnrealBloomPass` aveva soglia 1.0: il cielo intero
  entrava nel bloom e aggiungeva luce su tutta la scena. Ora soglia **3,2**, raggio 0,2,
  intensità 0,045 (high) / 0,065 (ultra). Insieme: esposizione 0,88 → **0,72**,
  `sunIntensity` 3,4 → 3,0, luce emisferica 0,4 → 0,3. Misura headless: luminanza media
  **184 → 155** a ultra, varianza 2496 → 5370 (più contrasto, non più "lavato").
- **Asfalto chiaro.** La texture CC0 è volutamente chiara (mostra la grana) e il
  materiale era bianco: risultava cemento. Ora tinta 0x8b8f92; sterrato 0xb9a68a.
- **Marciapiedi piatti.** Il nastro stava 3,5 cm sopra l'asfalto. Ora il piano è a
  +15 cm con **faccia verticale del cordolo** (`pushCurbWall`), che è quello che fa
  leggere il rialzo.
- **Erba sopra i marciapiedi.** L'esclusione usava `isOnRoad(..., 1.1)`: ora 2,7 m.
- **Ruote sotto l'asfalto / macchina a scatole.** Vedi commit precedenti; qui la
  carrozzeria è stata rifatta: padiglione **rastremato** (parabrezza e lunotto inclinati),
  passaruota a mezzo toro, interni (plancia, sedili), vetro meno nero, vernice meno
  specchio (metalness 0,35, clearcoat 0,55).
- **Avatar a cilindri.** Lati 6 → 14, torso e bacino a profilo di rivoluzione (lathe)
  appiattito in z, braccia/gambe affusolate, testa con mandibola, orecchie, naso,
  labbra e calotta capelli scalata come il cranio (prima il cuoio capelluto
  attraversava i capelli e il bordo era seghettato).
- **Case "scatole".** Oltre allo zoccolo: cornicione (fascia a sporto), comignolo con
  cappello, pluviali ai vertici, balconi con ringhiera sulle case a due piani, e
  **normal map della facciata** (vano finestra incassato, davanzale a sporto).

### Verifiche eseguite

- `npx tsc --noEmit` pulito, `npm test` **155/155**, `vite build` ok.
- Catture headless riproducibili (`node scripts/capture.mjs --quality high|ultra`)
  a ora fissa, confrontate a media: vedi numeri sopra.
- Controllo a runtime nel browser condiviso: `window.__molise.ready`, `errors` vuoto.

### Cosa resta da fare (in ordine)

1. **Erba**: i ciuffi a 15–30 m leggono ancora come foglie; servono lame più fini e
   minore contrasto con il terreno, oppure un tappeto di base verde sotto i ciuffi.
2. **Facciate**: mancano cornici ai piani, gronde e profondità reale delle finestre
   (oggi è tutta normal map).
3. **Terreno ravvicinato**: la foto satellite resta piatta; il dettaglio è solo
   modulazione di colore.
4. **Avatar**: è migliorato ma resta stilizzato; il prossimo passo è la skin mesh.

---

## 14. Passaggio del 22 ottobre 2026 (sera) — strade, arredo urbano, vegetazione, avatar

### Strade: curve vere, segnaletica, cordoli

- **Curve seghettate.** `roundCorners` spezzava solo i vertici secchi lasciando segmenti
  dritti: sulle polilinee OSM ricampionate a 7 m restavano zig-zag. Aggiunta
  `smoothPolyline(points, passes = 2, strength = 0.55)` (media pesata di Laplace, estremi
  fissi) applicata **dopo** `roundCorners`: l'asfalto ora è un arco continuo con raggio
  confrontabile col vero. I test di `roundCorners` restano validi (funzione invariata).
- **Marciapiedi.** Larghezza 1,45 m (strade < 6 m) / 1,8 m, cordolo a **18 cm** con faccia
  verticale (`pushCurbWall`). È lo scalino che si sente e che stacca la pavimentazione.
- **Attraversamenti pedonali.** `pushZebra` + `pushStopLine`: ogni ~70 m, solo su tratti
  dritti (coseno > 0,93) e solo dove ci sono edifici entro 26 m. 7 barre da 0,42 m.
- **Segnaletica verticale** (`buildSigns`, nuovo `src/world/street-furniture.ts`):
  STOP ottagonale, dare precedenza triangolare, limite 50 — facce disegnate su canvas
  (nessun asset), palo zincato, un cartello ogni ~55 m nelle zone edificate, max 700.
- **Arredo**: panche in legno/ferro vicino agli edifici grandi (`buildStreetProps`).

### Lampioni della luce

`StreetLights` (stesso modulo): palo affusolato 6,2 m con base, braccio inclinato verso
la carreggiata, testa in ghisa + vetro emissivo. Un lampione ogni ~32 m sui due lati
delle strade asfaltate dentro/attorno ai paesi (posizioni calcolate da `buildRoads`,
che ora restituisce `{ group, lamps }`). Di notte un **pool di 7 `PointLight`** viene
riassegnato ai lampioni più vicini alla camera: illuminazione pubblica senza 600 luci.
Emissive del vetro 6,5 × notte, testa 0,55 × notte. `Game` passa `nightFactor` calcolato
in `applyAtmosphere`.

### Vegetazione: più alberi, filari, crinali

- Cap `TREES_MAX` 7.000 → **14.000**; passo nei boschi 25 m → 17 m (uliveti 16, parchi 20).
- **Filari lungo le strade**: un albero ogni ~34 m, offset 4,2–9,7 m dal bordo, lato casuale.
- **Alberi sparsi** nei campi e sui crinali su griglia 52 m (probabilità 0,34, diradati su
  pendenza > 24°): è quello che dà tridimensionalità alle distanze, dove il DEM è liscio.
- Un solo helper `tryPlace` con gli scarti veri (pendenza, strada, edificio) per tutti e tre.

### Erba: tappeto di base

- Ciuffi 60.000 → **82.000**, quad più larghi (0,19 → 0,27 m), texture con 150 lame sottili
  (prima 42 larghe) su canvas 256.
- **Tappeto**: 12.000 quad orizzontali da 1,45 m con texture di macchie verdi a bordo
  trasparente, orientati sulla normale del terreno. Riempiono i buchi tra i ciuffi,
  che erano la causa dell'effetto "prato spelacchiato".
- Ricostruzione ogni 18 m (era 16) per non pagare due rebuild troppo spesso.

### Edifici: profondità vera

- **Fasce marcapiano** a ogni piano (una ogni ~3,1 m), a sporto di 1,4 cm.
- **Cantonali** in pietra agli spigoli (solo impronte ≤ 10 lati e area > 28 m²).
- **Grondaia** in zinco lungo tutto il filo della gronda, lato per lato.
- **Portone** sulla facciata più lunga: stipiti, architrave, battente in legno scuro
  incassato di 5 cm, soglia in pietra che sporge di 22 cm sul marciapiede.
- Helper `longestEdge()` condiviso con il balcone (prima il calcolo era duplicato).

### Avatar: proporzioni e dettagli

- **Testa** in un gruppo scalato 0,74: era larga 0,30 m (un quarto del corpo), ora ~0,23 m
  con cranio, mandibola, zigomi, orecchie, naso con dorso e narici, labbra, palpebre.
- **Occhi veri**: sclera + iride + pupilla (prima una sfera nera sola).
- **Collo** corto e pieno (10 cm visibili, era 13 su un bastone), spalle 0,20/0,185,
  deltoidi ridotti, torso a profilo a V.
- **Capelli**: calotta sferica piena ma spostata indietro, così davanti resta dentro il
  cranio e scopre la fronte (prima la semisfera copriva la faccia come un casco);
  frangia alta e basette per il taglio corto, massa arrotondata per i lunghi.
- **Vestiti**: cintura con fibbia, colletto ad anello (prima era un cartello davanti al
  petto), pannello camicia + alette + cravatta, bottoni, polsini, tasche, lacci.
- **Pelle e tessuto**: normal map procedurali (`src/gfx/detail-textures.ts`), pori a
  0,22 di scala e trama di cotone a 0,45–0,55.

### Verifiche

- `npx tsc --noEmit` pulito, `npm test` **155/155**, `vite build` ok.
- Cattura headless del mondo (`scripts/capture.mjs`, preset high, ora 15): lampioni,
  cartello del limite, curve continue e case con fasce/gronda/portone visibili.
- Avatar verificato a parte con `harness.html` + `scripts/shot.mjs` (1280×800, corpo e
  primo piano): `captures/av-body2.png`, `captures/av-head2.png`.
- **Nota onesta**: il capture del mondo con SwiftShader richiede minuti; l'ultima cattura
  completa è precedente alle ultime rifiniture dell'avatar (che non toccano la scena).

### Cosa resta debole

1. **Avatar**: è un umanoide procedurale credibile da 3–5 m, non una persona vera da 1 m.
   Per il salto servirebbe un GLB umanoide rigged CC0 (skin + texture) al posto delle mesh
   primitive, mantenendo le clip attuali sullo stesso scheletro.
2. **Alberi**: chioma a card, non volumi fogliari; a 20 m si nota.
3. **Terreno ravvicinato**: la foto satellite resta piatta; il dettaglio è solo colore.
4. **Prestazioni**: 14.000 alberi × 3 mesh + 82.000 ciuffi + 12.000 quad di tappeto sono
   pesanti su GPU integrate; prima di alzare ancora i numeri serve un LOD per distanza.
5. **Auto**: il tetto riflette il cielo e legge come una lastra chiara; abbassare
   `envMapIntensity` della vernice o alzare la rugosità.
## 15. Passaggio del 22 ottobre 2026 — personaggi umani veri e paese abitato

Il punto di partenza era l'obiezione giusta: gli avatar erano **soldatini fatti di
primitive**. Qualunque altro ritocco alla scena non avrebbe cambiato quella sensazione.
Quindi il rig procedurale non è stato migliorato ancora: è stato sostituito.

### Cosa è cambiato (causa, non sintomo)

- **Corpi veri, non primitive.** `src/entities/human-model.ts` carica due corpi
  Ready Player Me con skinning (58–60 ossa, ~15–20 k triangoli, pelle/volti/capelli/
  vestiti su mappa): `public/models/uomo.glb` e `donna.glb`. Il rig procedurale resta
  solo come fallback se i GLB non si caricano.
- **Animazioni di motion capture, non sinusoidi.** Sei clip dalla Ready Player Me
  Animation Library (`uomo-idle/walk/run`, `donna-idle/walk/run`), blend pesato fra
  idle/camminata/corsa con `timeScale` legato alla velocità reale.
- **Bind per nome d'osso** (`bindClip`): le clip sono scritte per la stessa riga, quindi
  si sostituisce il nome dell'osso con quello dell'istanza clonata. La traccia di
  posizione del bacino viene scartata: contiene root motion (e nelle clip femminili è in
  un'unità diversa) e faceva scivolare il personaggio avanti da solo.
- **Misura dell'altezza dallo scheletro, non dalla geometria.** `Box3.setFromObject` su
  una SkinnedMesh legge il bounding box in spazio di bind: da lì uscivano personaggi alti
  20 m o 20 cm. Si misura la span delle ossa e si aggiunge il 10% (cranio e piedi),
  fattore ricavato confrontando la misura con un render ortografico.
- **Pedoni** (`src/world/pedestrians.ts`): 6/10/18 a seconda del preset, camminano sui
  marciapiedi (offset laterale di `width/2 + 1,15 m` dalle strade asfaltate), altezza dal
  DEM, velocità 0,95–1,6 m/s, ogni tanto si fermano (4–15 s). Animazione solo entro 90 m,
  riciclo oltre 175 m, visibilità fino a 210 m. Alla partenza vengono piazzati entro 90 m
  dal giocatore: prima il più vicino stava a 85 m e il paese sembrava vuoto.

### Verifiche

- `tsc --noEmit` pulito, `npm test` **155/155**, `vite build` ok.
- `harness.html` ora carica i GLB (`loadHumanAssets`) e mostra i corpi veri:
  `captures/umani-volto.png` (volto), `captures/umani.png` (tre figure in cammino).
- Partita reale con Chrome headless (`?autostart=walk&quality=medium`): terza persona,
  `captures/peds4.png`; diagnostica runtime: 10 pedoni, il più vicino a 6,2 m.
- Frame rate nel capture headless: 2 fps (SwiftShader): le catture servono a verificare la
  scena, non le prestazioni.

### Cosa resta debole (onesto)

1. **Due soli corpi base** (un uomo, una donna): volti e vestiti sono dipinti nella
   texture, quindi tutti gli uomini hanno la stessa faccia e gli stessi jeans. La varietà
   viene da altezza, corporatura e tinta. Le opzioni carnagione/capelli/outfit nelle
   impostazioni ora non cambiano il modello.
2. **Logo sulle magliette** ("READY PLAYER ME") stampato nella texture: a 3 m si legge.
   Per toglierlo serve una texture ritoccata o un capo separato.
3. **Edifici**: le facciate sono ancora un unico intonaco chiaro con la finestra disegnata
   nella texture, ripetuta. È il prossimo salto visivo, più del terreno.
4. **Niente traffico, niente attraversamenti, niente folla in piazza.**

---

## 16. Passaggio del 22 ottobre 2026 (notte) - piano di realismo nel repo

Il brief ***Piano di realismo per lo sviluppo*** del proprietario ora vive nel repo:
**`docs/REALISM-PLAN.md`**. Da adesso è il riferimento unico per l'ordine di
lavoro sulla grafica.

- Il documento contiene il brief integrale più una sezione **Registro di
  avanzamento** con lo stato reale di ogni area (fatto / da verificare / da fare).
- Va aggiornato a ogni blocco di lavoro: si scrive solo ciò che è stato visto
  funzionare (`npm test`, `npm run build`, prova in browser).
- Le fasi consigliate sono: 0 misure, 1 veicoli, 2 luce, 3 strade, 4 alberi,
  5 orizzonte, 6 edifici, 7 personaggio, 8 ottimizzazione.
- `captures/` è ora in `.gitignore` (sono scatti di lavoro, non asset).

Verifiche di questo passaggio: `npm test` 155/155 in 14 file, `npm run build` ok.



## 23/10 — City kit threejsassets: pipeline pronta, asset in attesa

Il proprietario ha chiesto di portare nel gioco gli asset free di
<https://threejsassets.com> per rendere credibili strade, marciapiedi,
vegetazione e veicoli. Censimento del catalogo pubblico: **2.288 asset, 937 nel
tier free**, quasi tutti low-poly stilizzati; l'unico pack fotorealistico in
scala reale è **Realistic City**, con **18 asset free**, 13 dei quali utili a
Palata. Dettagli e tabella ruoli: `docs/CITYKIT.md`.

Fatto:

- `scripts/fetch-citykit.mjs` + `npm run kit`: scarica i 13 GLB con l'API keyed
  ufficiale (`THREEJSASSETS_KEY` in `.env.local`), una richiesta alla volta,
  verifica il magic `glTF`, calcola sha256 e scrive
  `public/citykit/manifest.json` + `NOTICE.md`. Copia anche il decodificatore
  Draco da `node_modules/three` in `public/draco/`.
- `--list` (catalogo, senza chiave) e `--index` (GLB scaricati a mano) verificati.
- `public/citykit/` e `public/draco/` in `.gitignore`: la Free Commercial License
  consente l'uso nei prodotti ma **vieta la ridistribuzione dei file**, quindi
  niente GLB nel repo (stessa regola delle texture CC0 da 28 MB).

Fatto dopo il download dei 13 GLB (23/10, 13/13 indicizzati):

- `src/world/citykit.ts`: loader Draco, **normalizzazione del pivot** (i GLB del
  pack hanno il pivot al centro del bounding box, non a terra), parti
  geometria+materiale e istanziazione con tinta per istanza.
- `src/world/roads.ts`: materiali PBR del kit su asfalto (`asphalt_slab`),
  lastre del marciapiede (`footway_flags`) e granito del cordolo
  (`granite_kerb`), con marciapiede e cordolo separati in due mesh. UV in metri,
  repeat 0,55 × 0,5; vertex color bianco; bagnatura meteo mantenuta.
- `src/world/street-furniture.ts`: panchine e cestini reali al posto delle
  scatole, con tetto per preset (21k triangoli l'una).
- `src/world/city-props.ts`: alberi di strada ogni ~26 m sul marciapiede e
  berline in sosta ogni ~28 m nel senso di marcia, tinte da una palette; solo
  dentro Palata e con tetti 0/10/22/32 alberi e 4/10/18/24 auto per preset.
- Diagnostica: `window.__molise.kit = { assets, trees, cars }`.

Non piazzati di proposito: semaforo, segnale, lampione, masso, piazza, incrocio
(scaricati, ma fuori contesto o da tarare). Il veicolo del giocatore resta
procedurale: il kit fornisce solo la berlina da sosta.

Per un'altra AI o un'altra macchina: **`docs/HANDOFF-AI.md`** contiene contesto,
comandi, vincoli di licenza, cosa manca da prendere da threejsassets e il primo
giro di verifica. È autosufficiente, non serve questa conversazione.

Verifiche di questo passaggio: `npx tsc --noEmit` ✅, `npm test` **171/171** ✅ in
18 file, `npm run build` ✅, `--list` e `--index` ✅, chiave non valida → errore
leggibile ed exit 1 ✅. **Verifica visiva/fps non eseguita**: su richiesta, il
proprietario ha chiesto di non lanciare test/browser. Da fare in gioco:
controllare che le auto non affondino (y = quota DEM + roadLift), che gli alberi
stiano sul marciapiede e che il piano stradale non sia slittato.

## 23/10 — Satellite: zoom ripristinato

- `zoomForDistance` in `src/world/imagery.ts`: z18 entro 500 m, z17 fino a 3200 m, z16 oltre. Il tetto reale resta `maxSatelliteZoom` del preset.
- Nuovo test `tests/imagery.test.ts`.
- Stato: test satellite e tsc verdi. Smoke non eseguito (interrotto su richiesta). Browser: il dev server è registrato nel pannello, verifica visiva da fare.
- Ancora da fare della priorità 1: patch, ortofoto locale, debug imagery, dettaglio pitch OSM.

## 23/10 — Kit: siepi, canneti, pietre e un relitto in campagna

Il proprietario ha messo in `public/citykit/` **150 GLB** presi dai pack free di
threejsassets. Non si usano tutti: il mondo resta geografico e le case di Palata
restano le impronte OSM, quindi case, negozi, auto e alberi low-poly sono fuori
(vedi `docs/CITYKIT.md` §1.3 per il motivo, uno per uno). Il kit curato passa da
13 a **20 asset**: ai 13 Realistic City si aggiungono 7 modelli low-poly per
quello che mancava davvero, cioè il margine di campagna.

### Cosa è cambiato

- **Indicizzazione offline.** `npm run kit -- --index` non chiama più l'API: legge
  i GLB presenti, tiene solo i 20 slug della lista curata, ricava triangoli,
  byte e sha256 dal file. Così si indicizza anche materiale di pack diversi e
  funziona senza rete. I 130 file restanti non entrano nel manifest e non
  vengono caricati (zero costo in RAM video e draw call).
- **Ruoli con varianti.** `CityKit` ora tiene una lista per ruolo: tre massi
  diversi sono tre varianti di `rock`, scelte per istanza con
  `KitSpot.variant`; una sola chiamata a `instances()` raggruppa per variante.
  I ruoli nuovi sono `hedge`, `bush`, `reed`, `rock`, `wreck`.
- **Siepi** (`city-props.ts`): solo su asfaltate strette e fuori dal paese,
  perché i muretti a secco occupano già le sterrate. Tratti di 25–65 m con
  varchi, a 2,6–3,8 m dal bordo, un rovo ogni ~6 segmenti verso il campo.
- **Canneti** lungo i 96 torrenti OSM, **pietre** su pendii 9°–42° (con il masso
  fotorealistico usato 1 volta su 8), **un relitto** in un fosso tra 520 e
  1700 m da casa. Tetti per preset: siepi 48/120/220/340, rovi 30/80/150/220,
  canneti 24/70/130/190, pietre 24/64/120/170.
- Siepi, rovi e canneti non proiettano ombre (centinaia di migliaia di
  triangoli, ombra invisibile); pietre e relitto sì.
- Diagnostica: `window.__molise.kit` = `{ assets, trees, cars, hedges, bushes,
  reeds, rocks, wrecks }`.

### Verifiche

- `npx tsc --noEmit` ✅ pulito. `npm run kit -- --index` ✅ 20/20 indicizzati,
  130 file segnalati come non usati.
- **`npm test`, build, browser, screenshot e fps NON eseguiti** su richiesta del
  proprietario ("nessun test, nessun run dev"). Da guardare in gioco: scala del
  relitto e dei massi, siepi che non entrano nelle case, canneti che non
  galleggiano sopra l'acqua.
- I GLB restano fuori dal repo (licenza Free Commercial): il commit contiene
  codice, manifest **non** incluso, script e documenti. Su una macchina nuova si
  copia `public/citykit/` + `public/draco/` e si lancia `npm run kit -- --index`.
