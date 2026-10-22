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
| Strade | ✅ aggiornato | nastri drappeggiati con PBR CC0 (asfalto/sterrato) + **marciapiedi e cordoli in cemento** solo sulle asfaltate, interrotti agli incroci |
| Edifici | ✅ aggiornato | estrusione + **tetti a falde** (padiglione) + facciate con finestre, persiane e davanzali |
| Vegetazione | ✅ aggiornato | tronchi con corteccia PBR, chiome a card fotografiche con `alphaMap`, vento nei vertici, max 7000 alberi |
| Prati | ✅ nuovo | ciuffi istanziati con texture di lame su canvas (`alphaTest`) e vento, densità dai preset |
| Acqua | ✅ aggiornato | nastri torrenti + poligoni laghi con normali scorrevoli e materiale fisico (clearcoat) |
| Meteo reale | ✅ nuovo | Open-Meteo + sole NOAA, cupola nuvole, pioggia/neve, switch in impostazioni |
| Radar / mappa | ✅ | satellite Esri z17 + overlay OSM, mosaico z14 per mappa grande |
| Itinerario | ✅ nuovo | click sulla mappa grande → A* sulla rete OSM, km e tempi, beacon 3D |
| Post-processing | ✅ aggiornato | bloom + **SSAO** (high/ultra) + SMAA + OutputPass, disattivabile |
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
5. **Terreno**: geometria 96×96 per chunk, normal map 128² dal DEM, texture
   progressive z15→z18 con sostituzione a runtime.
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
5. premi `M`, clicca su un paese e verifica che l'itinerario compaia con km e tempi,
   che la linea resti sulla minimappa e che `X` lo annulli;
6. premi `P`, attiva **Meteo reale**: verifica che il sole corrisponda all'ora e che
   nuvole/pioggia cambino; controlla `window.__molise.weather` e l'attribuzione
   Open-Meteo nel pannello;
7. esegui `npm run smoke` con `npm run preview` attivo (copre anche l'itinerario);
8. aggiorna questo handoff con data, commit, esito test e nuove priorità.

Buon lavoro. La cosa più importante: **il posto deve sembrare vero**.
