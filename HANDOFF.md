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
| Qualità | ✅ aggiornato | **5 preset** (compatibilità→ultra) con budget di mondo, auto-detect dalla GPU e **degradazione automatica a gradini** per i PC molto lenti |
| Audio | ✅ nuovo | WebAudio procedurale: motore per modello (cilindri/regimi reali), rotolamento, vento, passi, uccelli |
| Fisica auto | ✅ | modello bicycle puro, testato |
| Catalogo veicoli | ✅ aggiornato | **31 modelli**: 21 procedurali (8 + 13, prestazioni reali) + **6 auto di serie su GLB** + 4 carrozzerie del kit; più le auto importate dal garage |
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

Ultime verifiche fatte (macchina Windows, 24/10/2026, rete disponibile):
`npm ci` ✅, `npm test` 193/193 ✅ (19 file: geo, DEM, OSM, fisica auto, routing,
tetti, sole, economia, bisogni, catalogo luoghi, salvataggio, veicoli GLB,
voce del motore), `npm run build` ✅, gioco verificato dal vivo (Guida,
meteo pioggia/neve/foschia) senza errori in console — auto che avanza con `W`,
giocatore che cammina, schizzi di pioggia attivi (~126 anelli), foschia visibile,
casali e alberi di campagna in scena. Lo smoke che prima falliva (auto ferma a 0,43 m) ha rivelato
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
   energia 100), `I` per il portafoglio, e provare su strada i 31 modelli (i sei
   GLB e i quattro del kit sono già stati provati in questa sessione). Segnare
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

## 23/10 — Piazza, targhe delle vie e auto low-poly

Continuazione dello stesso passaggio. Il kit curato passa da 20 a **24 asset**
(13 Realistic City + 7 scenery + 4 berline low-poly) e il paese guadagna
quattro cose che prima mancavano: un sagrato lastricato, i nomi delle strade,
varietà nelle auto in sosta e i segnali sul palo zincato vero.

### Cosa è cambiato

- **Piazza davanti alla chiesa** (`src/world/piazza.ts`): 16 × 12 m (si restringe
  a 13 × 10 o 10 × 8, o non si costruisce, se c'è una strada o un pendio forte),
  drappeggiata sul DEM con UV metriche e materiale `plaza/paving`; cordolo in
  granito sui lati aperti, due panchine. L'impronta va in `paved.ts` e da lì a
  erba e vegetazione, così non ci crescono sopra; **non** entra nelle collisioni.
  Senza kit non esiste: non c'è un fallback procedurale.
- **Targhe con il nome della via** (`buildStreetNames`): nome OSM su targa bianca
  con bordo blu disegnata su canvas, palo a bordo marciapiede, una per strada
  costruita (max 2 omonime a 900 m), max 60. Funziona anche senza kit.
- **Auto low-poly** (`car-lowpoly`, 4 varianti): il muso è a **+Z** — verificato
  decodificando i GLB con il decodificatore Draco di three e leggendo i colori:
  i fari rossi stanno a −Z. Quindi si parcheggiano con lo stesso yaw della
  berlina fotorealistica, senza ipotesi. Scala ricalcolata sulla lunghezza vera
  (4,3 m); il 45% delle auto oltre 150 m da casa è low-poly, vicino allo spawn
  resta solo la fotorealistica.
- **Segnali** (`buildSigns`): il palo è la parte `ss_galv` del cartello del kit
  (2,95 m), la faccia resta il canvas italiano perché le forme vere sono
  ottagono STOP, triangolo "dare precedenza" e disco 50. Corretto anche il
  triangolo della precedenza, che prima puntava in alto: ora punta in basso e
  il bordo rosso è disegnato dentro la sagoma. Faccia a 2,52 m, base sul piano
  del marciapiede (asfalto rialzato + cordolo, 38,5 cm sopra il DEM); senza kit
  resta il palo procedurale da 2,1 m.
- Diagnostica: `window.__molise.kit` aggiunge `piazzas` (1 se il sagrato è stato
  costruito, 0 se non c'era spazio).

### Verifiche

- `npx tsc --noEmit` ✅ pulito. `npm run kit -- --index` ✅ 24/24 indicizzati,
  126 GLB non usati.
- **`npm test`, build, browser, screenshot e fps NON eseguiti** su richiesta del
  proprietario. Da guardare in gioco: piazza che si appoggia ai gradini, targhe
  leggibili e non dentro i muri, auto low-poly con il muso nel verso giusto,
  altezza dei segnali sul palo del kit.

## 23/10 — Auto del kit guidabili e garage Smooth Voxels

Il proprietario ha chiesto due cose: mettere subito in gioco i veicoli dei GLB e
poter modellare le proprie macchine in Smooth Voxels. Fatte entrambe, più il
documento con quello che manca e gli otto esempi three.js indicati.

### Auto del kit guidabili

- **Quattro voci nuove** in `src/sim/vehicle-catalog.ts`: `kit-family-sedan`,
  `kit-paris-car`, `kit-pastel-sedan`, `kit-convertible`. Ognuna ha il campo
  `model` con lo slug del GLB (`family-sedan`, `paris-car-01`, `pastel-sedan`,
  `white-sports-convertible`).
- **Rendering** (`src/entities/vehicle.ts`): `resolveExternal` cerca l'asset con
  `CityKit.bySlug`, clona il template e lo scala sulla lunghezza dello spec.
  L'asset ha il muso a +Z, il gioco guida a −Z: rotazione di 180°, base a terra,
  centro su x/z. I due `SpotLight` dei fari si aggiungono anche qui.
- **Fisica**: quella di sempre, con ingombri e prestazioni dello spec. Le
  prestazioni delle voci `kit-*` sono **riferimenti di segmento**, non schede
  reali: il commento nel catalogo lo dice.
- **Tinta**: per i GLB il menu mostra un avviso e non applica la palette
  (`Vehicle.paintable`).
- **Ruote**: le low-poly sono un solo oggetto, quindi restano ferme. Se il kit
  manca, si ricade sulla carrozzeria procedurale senza errori.
- La berlina fotorealistica resta solo in sosta (ruote fuse nei materiali
  `rub`/`alloy`).

### Garage Smooth Voxels

- **`src/garage.ts`** (nuovo): legge il GLB con `GLTFLoader` (+ Draco),
  normalizza asse lungo su Z, base a 0, centro e scala, ricava una scheda
  plausibile dagli ingombri e salva il file in IndexedDB.
- **Import**: file picker nel menu (`Auto personalizzate`) e drag & drop sulla
  finestra. Le auto compaiono nella select con `★`, sono guidabili subito e
  restano dopo il ricaricamento. Massimo 12 per browser; pulsante per svuotare.
- **Ruote animate opzionali**: se il GLB ha oggetti separati `wheel-fl`,
  `wheel-fr`, `wheel-rl`, `wheel-rr` con l'origine al mozzo, il veicolo crea un
  perno, le fa sterzare e girare. Documentato in `docs/GARAGE.md`.
- **Nessun tint** sui modelli importati: materiali e texture restano quelli
  dell'utente. Il colore si cambia nell'editor.
- **UI**: sezione in `index.html`, stili in `src/style.css`, wiring in
  `src/game.ts` (`loadCustomCars`, `importCars`, `clearImportedCars`).
- Smooth Voxels è un editor esterno: il progetto ci si collega, non lo incorpora.

### Documenti

- **`docs/GARAGE.md`**: flusso completo, convenzioni (1 unità = 1 m, muso +Z,
  base a 0, nomi ruote), cosa fa l'import, limiti, problemi tipici, licenza.
- **`docs/ROADMAP-VISUALS.md`**: cosa manca ai GLB delle auto (ruote separate,
  interni, fari emissivi, tinta, LOD, collisioni, suono, animazioni) e come
  usare gli otto esempi three.js: `webgl_materials_car`,
  `webgpu_generator_building`, `webgpu_compute_particles_rain`,
  `webgpu_compute_particles_snow`, `webgpu_custom_fog`,
  `webgl_geometry_terrain`, `webgl_animation_skinning_blending`,
  `webgl_animation_skinning_additive_blending`. Include la nota che gli esempi
  `webgpu_*` non girano sul `WebGLRenderer` attuale.
- **`docs/CITYKIT.md`**: nuova §1.3.1 sulle carrozzerie guidabili e stato
  aggiornato.

### Verifiche

- `npx tsc --noEmit` ✅ e `npm test` **179/179** ✅ sul blocco di codice
  principale. Le ultime rifiniture (rinomina di `clearGarageRecords`, filtro
  solo `.glb`, testi UI) non sono state ricontrollate.
- **Build, browser, screenshot e fps NON eseguiti**: il proprietario ha chiesto
  di non lanciare test su questa macchina (niente rete/PC adatto); farà la
  verifica da un'altra macchina.
- Da guardare in gioco: auto del kit con il muso nel verso giusto e non
  interrate, nessuna doppia ruota, auto importata della lunghezza giusta,
  ruote separate che sterzano, garage che ricarica dopo F5.

## 23/10 — Ruote separate, vernice con riflessi e correzione del muso

Tre richieste del proprietario, tutte sulle auto: correggere il muso delle auto
importate, rendere la vernice realistica, e far girare le ruote in modo
realistico soprattutto al contatto con l'asfalto.

### Ruote animate (`src/entities/car-wheels.ts`, nuovo)

- I GLB del kit e quelli di Smooth Voxels escono spesso come **un solo oggetto**:
  la separazione ora avviene a runtime. Si collegano i triangoli che condividono
  lo stesso vertice (weld a 1 mm, union-find), si isolano le componenti a forma
  di ruota (due assi larghi e uno stretto, nella metà bassa del veicolo) e le
  quattro più vicine agli angoli diventano quattro ruote con un perno al mozzo.
- **La geometria originale non si tocca** (i template del kit sono condivisi con
  le auto parcheggiate): si creano nuove geometrie con gli stessi vertici,
  normali e UV, quindi la texture resta allineata. Se l'analisi non trova quattro
  ruote plausibili non si tocca nulla.
- **Raggio reale**: il raggio della ruota viene misurato sul modello e usato per
  il rotolamento (`wheelSpin += speed / radius`), quindi una carrozzeria con
  pneumatici più grandi dello spec non "striscia" sulla strada.
- La separazione sulle auto del kit si fa **una volta sul template** e poi viene
  ereditata da ogni clonazione; per le auto importate avviene alla prima
  costruzione e il perno resta nel modello.
- Le ruote dichiarate a mano (`wheel-fl`… con origine al mozzo) continuano a
  funzionare come prima.

### Ombre di contatto

- Quattro quad sfumati sotto le ruote (texture condivisa da 96 px, `MeshBasicMaterial`,
  `depthWrite: false`, a 6 mm dal piano): chiudono il punto in cui la gomma
  tocca la strada. Le ombre del sole arrivano da lontano e lasciano sempre un
  alone chiaro nel contatto.
- Vengono messe anche sotto le carrozzerie procedurali, nelle posizioni di
  passo e carreggiata.

### Vernice realistica

- La cubemap PMREM del cielo (`sky.updateEnvironment` → `scene.environment`)
  arriva adesso anche ai materiali del veicolo: `Vehicle.setEnvironment` la
  applica con un **boost per famiglia** (vernica 2,4×, vetri e cromature 3,0×,
  lenti 1,9×, plastiche 1,25×), così la carrozzeria ha riflessi ampi e le
  plastiche restano opache.
- La vernice è passata a clearcoat 1,0, clearcoatRoughness 0,06, metalness 0,5,
  roughness 0,30. La stessa mappa viene passata anche ai materiali dei GLB.
- Il Game la aggiorna quando il cielo rigenera la cubemap (confronto per
  identità, nessun costo nei frame normali).

### Muso 180° per le auto importate

- Nuovo pulsante **Ruota il muso 180°** nel pannello garage: visibile solo quando
  il veicolo corrente è un'auto importata.
- La scelta diventa `flip` nel record IndexedDB, quindi sopravvive al
  ricaricamento; il modello viene riletto e normalizzato con la rotazione.
- Nuove funzioni in `src/garage.ts`: `readGarageRecord`, `buildGarageScene`.

### Verifiche

- **Nessun test, nessuna build, nessun browser**: su richiesta del proprietario
  (questa macchina non ha rete e non è adatta). Il controllo statico a fine
  blocco è stato fatto a mano. Da verificare in gioco, in ordine: le quattro
  auto del kit con le ruote che girano, l'ombra di contatto al posto giusto, la
  vernice che riflette il cielo, l'auto importata con il muso girato.
- Restano fermi i precedenti punti: fari emissivi dei GLB, LOD, collisioni per
  modello, suono per auto (vedi `docs/ROADMAP-VISUALS.md`).

---

## 23/10 — Auto GLB guidabili, campagna popolata, pioggia/neve/foschia

Questa sessione ha chiuso tre richieste del proprietario: **le sei auto GLB
devono essere davvero guidabili**, **i GLB dei due ZIP devono comparire nel
mondo** (non solo essere indicizzati) e **l'ambiente va migliorato** con gli
esempi Three.js indicati.

### Auto di serie su GLB (`public/cars/`, `src/world/car-library.ts`)

- **Libreria separata dal garage.** `public/cars/manifest.json` (versionato)
  elenca slug, file, nome, `yaw` e lunghezza; i `.glb` restano fuori da git.
  Le auto importate dall'utente continuano a vivere in IndexedDB: sono due
  sistemi distinti, e `docs/GARAGE.md` ora lo spiega.
- **Normalizzazione una volta sola**: modello ruotato di `yaw`, riscalato a
  lunghezza unitaria (`z = 1`), muso verso **+Z**, base a `y = 0`, centrato in
  x/z. La scala finale viene da `spec.length`. Le misure dell'ingombro usano
  `preciseBox()` sui vertici, non `Box3.setFromObject` (che include i nodi
  vuoti e sballa le auto con pivot strani).
- **Materiali da showroom corretti**: i GLB avevano vetri bianchi/opachi e
  emissive finte. I vetri riconosciuti per nome diventano trasparenti e scuri;
  l'emissive dello showroom viene azzerata; la cubemap del cielo arriva anche
  a questi materiali.
- **Ruote**: ordine di ricerca — nomi dichiarati → nodo hub più alto →
  clustering geometrico agli angoli → `splitCarWheels`. Il raggio è misurato
  sul modello, quindi il rotolamento combacia col terreno.
- **Cambio esteso**: `SEVEN_SPEED` e `EIGHT_SPEED` in `src/sim/car.ts`;
  `gears` accetta `1 | 5 | 6 | 7 | 8`. Le supercar hanno rapporti e limitatore
  coerenti (Aventador, Ferrari 458, Audi R8); il test di velocità massima è
  stato alzato a 360 km/h.
- **Selezione asincrona**: l'auto scelta viene precaricata e la selezione usa
  un **generation counter**, così cambi rapidi dal menu non applicano un GLB
  vecchio sopra quello nuovo. Se il file manca, si ricade sulla sagoma
  procedurale dello stesso spec.

Modelli: Fiat Punto, Lamborghini Aventador, Ferrari 458 Spider, Land Rover
Defender, Audi R8 V10 Performance, Cupra Terramar. Verificati in gioco uno per
uno; in particolare il vetro posteriore dell'Audi è ora scuro e la Cupra
Terramar ha muso e scala corretti (`yaw +90` nel manifest).

### City kit: da 24 a 38 asset, campagna vera

- Il kit indicizzato passa a **38 GLB**: 13 Realistic City, 7 scenari, 4 auto
  low-poly e **14 modelli rurali** (6 case, 2 rimesse, 6 alberi da campo).
  `scripts/fetch-citykit.mjs` ha le liste `RURAL` e `COUNTRY_TREES`; gli altri
  112 GLB presenti in `public/citykit/` restano fuori dal manifest.
- Nuovo `src/world/farmsteads.ts`: i casali vengono messi **solo fuori dal
  paese** (raggio 260–2300 m), a 15–30 m dalle strade rurali, con distanza
  minima di 105 m tra loro e controlli su pendenza, acqua e edifici. La
  posizione è deterministica (`mulberry32`, seed fisso).
- **Impronte di collisione**: ogni casa e rimessa viene registrata in
  `BuildingIndex` **prima** di vegetazione, erba e alberi. Così il giocatore
  non ci passa attraverso e nulla ci cresce dentro. Le impronte sono rettangoli
  ruotati, non AABB.
- Statistiche ad alta qualità verificate dal vivo: **18 case, 11 rimesse,
  46 alberi di campagna**. I limiti scendono con i preset grafici; l'acero
  autunnale (88k triangoli) compare solo su high/ultra e con peso basso.
- I ruoli nuovi (`house`, `shed`, `tree-country`) sono nel contratto
  `KitRole`; `docs/CITYKIT.md` è stato riscritto con la tabella dei 38 asset,
  il placement e i conteggi.

### Pioggia, neve e foschia (`precipitation.ts`, `mist.ts`)

- **Neve soffice**: sprite con gradiente radiale su canvas e shader dedicato,
  dimensione per particella e leggero ondeggio; niente più quadrati.
- **Schizzi di pioggia**: pool di 260 anelli che nascono sulla superficie vera
  intorno alla camera. Il sampler fornito dal gioco tiene conto dell'asfalto
  (20 cm sopra il DEM), altrimenti l'anello sparisce sotto la strada. Durata
  media 0,55 s e budget di 12 nascite per frame: niente picchi.
- **Foschia bassa** (`src/world/mist.ts`): 16 banchi morbidi a 0,6–7,5 m dal
  suolo, ancorati al mondo (non alla camera) e riciclati in un box di 720 m.
  Si addensano all'alba/tramonto, con nebbia e pioggia; la neve secca l'aria e
  li riduce. Ispirati a `webgpu_custom_fog`.
- Gli spunti Three.js usati: `webgpu_generator_building`,
  `webgpu_compute_particles_rain`, `webgpu_compute_particles_snow`,
  `webgpu_custom_fog`, `webgl_geometry_terrain`,
  `webgl_animation_skinning_blending`, `webgl_animation_skinning_additive_blending`.
  Tutto riscritto in WebGL classico: nessun compute shader, nessuna dipendenza
  WebGPU, così gira anche sui preset bassi.

### Animazione del personaggio (`src/entities/human-model.ts`)

- Il vecchio interruttore idle/walk/run è diventato un **blend continuo**:
  due `smoothstep` sulla velocità danno i pesi, poi i pesi vengono
  rinormalizzati a 1 (altrimenti durante la transizione traspare la posa di
  riposo e il corpo sembra afflosciarsi). Il passo accelera con la velocità.
  Schema da `webgl_animation_skinning_blending`.

### Verifiche di questa sessione

- `npm run build` ✅ (`tsc --noEmit` + Vite).
- `npm test` ✅ **189/189** in 18 file.
- Gioco dal vivo su `npm run preview` (`:4173`): sei auto GLB guidabili,
  nessun errore console; pioggia con schizzi attivi (~126), neve soffice,
  foschia visibile, 18 casali / 11 rimesse / 46 alberi in scena.
- **Nota per chi riprende**: il tool di screenshot del browser può fallire con
  «Screenshot needs a visible tab». Workaround usato: `renderer.render(...)` +
  `canvas.toBlob` e POST a un server locale su `:4199`
  (`%TEMP%\opencode\shot-server.mjs`), immagine in
  `%TEMP%\opencode\game-shot.png`. Non è un problema del gioco.

## 24/10 — Luce ricalibrata sul cielo, motore sonoro per modello

### La luce era ancora troppo alta: la colpa era della cupola, non del sole

Il proprietario ha chiesto di abbassare la luce. Il primo tentativo (esposizione
0,72 → 0,58, sole 3,0 → 2,4) scuriva il terreno ma **lasciava il cielo bianco**:
la cupola Preetham lavora in unità radiometriche e, con l'esposizione tarata
sull'asfalto, finiva fuori scala. Risultato: terreno nero e orizzonte bruciato,
cioè l'opposto di una scena leggibile.

Soluzione in due parti:

- **`dimSky()` in `src/world/sky.ts`**: una `skyRadiance = 0.55` moltiplica il
  colore della cupola visibile **e** di quella fotografata per la cubemap PMREM.
  Il cielo torna un gradiente blu; il sole e le nuvole restano sopra.
- **Ambiente compensato**: `scene.environmentIntensity` viene diviso per
  `SKY_RADIANCE` (`(0,08 + 0,22·day) / 0,55`), così la luce riflessa dal cielo
  non cala insieme alla cupola e i materiali PBR non si spengono.
- **Taratura**: `EXPOSURE_DAY = 0,62`, moltiplicatore sole **2,6**, emisferica
  dinamica `0,08 + 0,24·day`, ambiente `0,035 + 0,075·day`; `DEFAULT_LIGHTING`
  a sole 2,15 / emisferica 0,7 / ambiente 0,18. Cielo sereno: turbolenza 1,4,
  rayleigh 2,0, mie 0,0015; foschia 1800–5900 m con colore `#b9cbd8`.

Misure con la pipeline di post-processing attiva (canvas 702×686, ore 10:00
sereno): **luminanza media 92,6/255** contro 138,1 della vecchia taratura,
cielo blu invece che bianco. Pioggia 94,4, nebbia 116,4 (con sole basso nel
fotogramma), tramonto 14,5. Il cielo non è più la fonte di abbagliamento e il
terreno resta leggibile senza dover alzare l'esposizione.

**Trappola per chi riprende**: catturare con `g.post.render(0.016)` seguito
subito da `canvas.toBlob`; un semplice `renderer.render` salta bloom/SMAA/OutputPass
e restituisce colori diversi. Non fermare `g.running`: parte `idle()` e sposta
la camera in volo.

### Motore sonoro per modello (`src/audio/audio.ts`)

- `engineVoice(spec)` ricava i cilindri dalla sigla (`V12`, `V8`, `W12`, `I6`,
  `V-twin`), con la trappola delle **valvole**: `1.2 Fire 8V` è un quattro
  cilindri, non un V8. Peso timbrico dalla cilindrata, regimi da `idleRpm` e
  `redlineRpm`.
- Il sintetizzatore usa la **frequenza di accensione reale**:
  `rpm / 60 × cilindri / 2`. Un V12 al minimo ronfa a ~85 Hz, un 1.2 a ~27 Hz;
  il filtro e il guadagno seguono carico e giri. Prima il motore era un
  `42 + speed·2,6` uguale per tutti.
- `Game.update` passa `car.rpm`; `start()` e `applyVehicle()` chiamano
  `audio.setVoice(engineVoice(spec))`. Verificato dal vivo: Cupra → 4 cilindri,
  Aventador → 12.
- Nuovo test `tests/engine-voice.test.ts` (4 casi): **193/193** in 19 file.

### Verifiche di questa sessione

- `npm run build` ✅, `npm test` ✅ **193/193**.
- Dal vivo su `:4173` (qualità high): nessun errore console; Cupra e Aventador
  guidabili, cielo blu a mezzogiorno, pioggia con schizzi, nebbia con foschia
  bassa, notte con stelle e fari.
- Catture riuscite: `%TEMP%\opencode\new-10.png`, `new-rain.png`, `new-fog.png`,
  `new-18.png`, `aven10.png`.

### Cosa resta aperto

- **Licenza dei GLB delle auto**: i file sono del proprietario e non sono
  versionati; va verificata prima di una distribuzione pubblica.
- LOD per gli alberi del kit (l'ulivo è 22k triangoli, l'acero 88k), fari
  emissivi dei GLB, collisioni per modello invece del cerchio.
- I 112 GLB del kit rimasti fuori dal manifest sono disponibili se servono
  altri arredi, ma non vanno indicizzati in blocco: il filtro è la coerenza
  con Palata.

## 24/10 — Qualità per tutte le macchine (compatibilità → ultra)

Richiesta del proprietario: lo switch di qualità c'è, ma il gioco deve girare
anche sui PC deboli. Il problema non era il resolution scaling: era che il
preset `low` **non era una modalità debole**. Costruiva comunque 14.000 alberi,
2.600 cespugli, ombre su tutto, 2,3 milioni di triangoli di cornici e persiane,
chiusini e un palo del kit da 28.000 triangoli per ogni cartello (≈9,9 milioni
di triangoli in mappa a `high`).

### Cosa è cambiato

**Cinque preset con budget di mondo** (`src/gfx/quality.ts`). Oltre a
pixel ratio, ombre, post e zoom satellite, ogni preset decide alberi, cespugli,
pedoni, ciuffi d'erba, luci dei lampioni, raggio del terreno, meteo, kit,
chiusini e dettaglio delle facciate.

| Preset | Alberi | Erba | Pedoni | Terreno | Ombre | Post | Kit | Facciate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `minimal` (Compatibilità) | 2.200 | no | no | 1,5 km, z15 | no | no | no | semplificate |
| `low` (Bassa) | 4.500 | 0,22 | 4 | 2,2 km, z16 | sì, 1024 | no | sì | semplificate |
| `medium` (Media) | 8.000 | 0,45 | 10 | 2,6 km, z17 | sì, 1024 | no | sì | piene |
| `high` (Alta) | 12.000 | 0,72 | 18 | 3,1 km, z18 | sì, 2048 | bloom+SSAO | sì | piene |
| `ultra` | 14.000 | 1,0 | 22 | 3,1 km, z18 | sì, 4096 | bloom+SSAO | sì | piene |

- **Rilevamento GPU vero** (`classifyQuality`, testata): usa
  `WEBGL_debug_renderer_info`. Rendering software (SwiftShader/llvmpipe) →
  `minimal`; Intel/iGPU → `low` (o `medium` con 8+ core e 8 GB); 2 core →
  `minimal`; GPU dedicata → `high`. `?quality=` e `localStorage` restano
  prioritari. L'MSAA si decide **prima** di creare il renderer: su `minimal`
  il contesto nasce senza antialias.
- **Degradazione automatica a gradini**: prima il resolution scaling fino al
  minimo del preset; se restano tre controlli consecutivi sotto i 26 fps,
  scattano nell'ordine ombre off → erba off → meteo/foschia off e z15 → terreno
  a 1,6 km → scala 0,5× e terreno a 1,2 km. È permanente per la sessione (niente
  grafica che oscilla) e si azzera cambiando preset a mano. Il gradino 1 avvisa
  con un toast.
- **Facciate semplificate** (`buildingDetail: 'simple'` su minimal/low): muri,
tetti, zoccolo, cornicione, comignolo, portone e vetri restano; spariscono
cornici, davanzali, persiane, pluviali, cantonali e balconi. Misurato a Palata:
`building-trim` **2.299.200 → 203.276** triangoli.
- **Cartelli**: palo cilindrico procedurale al posto della parte `ss_galv` del
  kit (28.000 triangoli l'una). `road-signs` passa da **9,9 M** a poche decine
  di migliaia di triangoli, uguale su tutti i preset.
- **Chiusini e caditoie** non si costruiscono su minimal/low: due InstancedMesh
  da ~600.000 triangoli in mappa.
- **Post-processing pigro**: il composer (`EffectComposer`, SSAO 1024², SMAA)
  si crea solo quando il preset lo usa. Su minimal/low/medium non occupa VRAM.
- **Bug vero trovato e corretto**: `Terrain` veniva creato senza
  `maxSatelliteZoom`, quindi `applyQuality` (che gira nel costruttore, prima del
  terreno) non aveva effetto e **ogni preset scaricava tile z18**. Ora il tetto
  arriva al costruttore: `minimal` usa z15, `low` z16.
- **Meteo come interruttore**: con `weather: 'off'` nuvole, pioggia, neve e
  foschia non si aggiornano e il gruppo resta nascosto. Le 2 luci dei lampioni
  di `minimal` sostituiscono il pool da 7.
- **Impostazioni**: nuova tendina **Qualità grafica** (compatibilità→ultra) con
  la descrizione del preset e degli alberi al caricamento. `G` ora cicla su
  cinque livelli. Nota onesta nell'interfaccia: alberi e arredo cambiano al
  prossimo avvio; erba, ombre ed effetti subito.
- **WebGL2 assente**: `main.ts` mostra un messaggio che spiega cosa fare invece
  di lasciare la pagina nera.
- **Diagnostica**: `window.__molise` aggiunge `gpu`, `drawCalls`, `triangles`,
  `degraded`. I contatori sono azzerati a mano a ogni frame: con il
  post-processing il reset automatico lasciava solo la passata finale (1 draw
  call, 1 triangolo).

### Misure e verifiche

Headless Chrome + SwiftShader (`--use-angle=swiftshader`), spawn in auto a
Palata, preset **minimal**: **5,29 M → 2,54 M triangoli**, 123 draw call, 5–8
chunk con texture z15 (prima z18). `high`: scena caricata, 839 draw call, 35,8 M
triangoli **compresi passata d'ombra e post**, nessun errore runtime; su
SwiftShader gira a ~2 fps, che non dice niente sulle GPU vere.

La degradazione automatica è stata provata dal vivo su `medium` (SwiftShader,
~0,5 fps): in ~100 s ha applicato **tutti i gradini** (ombre off → erba off →
meteo off → terreno 1,6 km → scala 0,5× e terreno 1,2 km). Triangoli per frame
**11,88 M → 7,25 M**, draw call **386 → 216**, `errors` vuoto: la ricompilazione
dei materiali dopo lo spegnimento delle ombre non ha prodotto errori.

Durante questa prova è emerso un altro bug della stessa famiglia di quello del
23/10: il `dt` veniva limitato a 0,5 s **anche per il conteggio degli fps**,
quindi ogni frame più lento di mezzo secondo risultava "2 fps" e la
calibrazione non capiva mai di essere su una macchina da 0,5 fps. Ora gli fps e
il timer della degradazione usano il tempo reale (limitato a 2 s solo per
ignorare il ritorno da una scheda in background); la fisica continua a usare il
`dt` limitato.

- `node node_modules/typescript/bin/tsc --noEmit` ✅
- `node node_modules/vitest/vitest.mjs run` ✅ **203/203** in 20 file (nuovo
  `tests/quality.test.ts`: 10 casi su preset e classificazione GPU)
- `node node_modules/vite/bin/vite.js build` ✅
- `SMOKE_QUALITY=minimal npm run smoke` ✅ verde: nessun errore console, auto che
  avanza, giocatore che cammina, itinerario, immagine non piatta
- `npm run smoke` a `high` **non completato** in SwiftShader (timeout oltre 10
  minuti): non è un fallimento del gioco, ma la prova fps su GPU vera resta da
  fare. Il caricamento di `high` è stato verificato a parte.

Nota per chi riprende: lo smoke ora accetta `SMOKE_QUALITY` e non pretende i
chunk z17+ quando il preset ha un tetto più basso (prima falliva per costruzione
su `minimal`/`low`).

### Cosa resta per i PC più deboli

1. **Misurare gli fps veri** su una GPU integrata (Intel UHD/HD, Vega) nelle tre
   posizioni di prova del piano di realismo. I numeri qui sono SwiftShader.
2. **Marciapiedi e cordoli**: 750.000 + 231.000 triangoli generati su *tutte* le
   strade asfaltate, anche in aperta campagna. Generarli solo dove c'è un
   edificio entro ~40 m taglierebbe la voce più grossa rimasta su `minimal`, ed
   è anche più realistico.
3. **LOD/alberi**: la densità è fissata al caricamento. Un LOD per distanza (o
   il passaggio delle istanze lontane a card) permetterebbe di alzare i numeri
   senza costruire un mondo doppio.
4. **Geometria unita**: case e strade sono mesh uniche per famiglia, quindi il
   frustum culling non risparmia nulla; dividerle per tile di ~500 m darebbe
   un taglio silenzioso su tutti i preset.
5. **Texture KTX2** e GLB compressi (fase 8 del piano): meno VRAM e caricamento
   più rapido, soprattutto sul kit e sulle auto.
6. **Mobile**: il classifier ora non sale sopra `low` sui telefoni, ma mancano
   joystick virtuale e DPR limitato.

## 24/10 — Vernice delle auto, orizzonte, passo dei pedoni

Richiesta del proprietario: i colori delle auto erano troppo saturi, dovevano
essere cambiabili dalle impostazioni, e la grafica doveva chiudere i punti P1
del piano visuale. Fatto tutto senza toccare gli asset.

### Vernice (`src/gfx/car-paint.ts`, nuovo)

- **Riconoscimento**: `isPaintMaterial` accetta `carpaint`, `Body_Color`,
  `Body Paint`, `M_CarPaint_NoRV*`, `punto-body`… e rifiuta vetri, gomme,
  cromature, luci, targhe, interni. Se il modello non ha nomi utili ma ha un
  materiale dominante (≥ 35% dei triangoli, ≤ 6 materiali) lo prende per area:
  è il caso dell'Aventador (`_BodySG`).
- **Finitura**: `MeshPhysicalMaterial` con clearcoat 1, `clearcoatRoughness`
  0,06, rugosità 0,32 se il GLB non porta una mappa di rugosità. Attenzione:
  `MeshPhysicalMaterial.copy()` **non accetta** un materiale Standard (legge
  `clearcoatNormalScale`, che lì non esiste) — si copia lo strato Standard con
  `MeshStandardMaterial.prototype.copy.call(paint, source)`. Era un crash vero,
  trovato dal primo test in Node.
- **Tinta**: i materiali della scocca vengono clonati per istanza (il template
  è condiviso). Se il colore è nella texture (Audi blu, Defender grigio) la
  tinta passa dallo shader come `tinta × luminanza`, altrimenti
  `material.color`. Gli atlanti unici (Aventador, che include i cerchi) sono
  `tintable: false`: si desaturano soltanto.
- **Saturazione**: uniform condivisa `uPaintSaturation`, 35–100%, default 82%,
  slider in Impostazioni e valore salvato. Agisce sull'albedo dopo la texture.
- **Fari**: i materiali `lens`/`light` del GLB si accendono con `setLights`
  (0 di giorno, 1,9 di notte), senza `needsUpdate` per frame.

### Orizzonte (`src/world/far-terrain.ts`, nuovo)

Anello polare 34 × 160 (≈ 10.900 triangoli) da `viewRadius × 0,7` a 11 km, una
sola draw call. Dentro il DEM usa `Heightfield.heightAt` (nessun gradino),
fuori somma rumore *ridged* che cresce con la distanza dal bordo. Colori per
vertice (prato → faggeta → roccia) con velo d'aria crescente, Lambert + nebbia
della scena. Si ricampiona ogni 350 m di cammino e sta 2–12 m sotto il terreno
nella fascia di sovrapposizione. La nebbia serena arriva a ~8 km.

### Passo dei pedoni (`src/entities/human-model.ts`)

`syncStridePhase` riporta la clip meno pesante alla stessa frazione di falcata
della principale a ogni frame: durante il blend camminata ↔ corsa i piedi non
cambiano più ritmo a metà falcata.

### Verifiche

`tsc --noEmit` 0 errori, `vitest run` **233/233** (23 file; nuovi
`tests/car-paint.test.ts`, `tests/far-terrain.test.ts`,
`tests/human-gait.test.ts`), `vite build` ok,
`SMOKE_QUALITY=minimal npm run smoke` **superato** (124 draw call, 2,55 M
triangoli, 0 errori console). In Chrome headless i sei GLB sono stati caricati
davvero: Ferrari → `Body_Color` tintabile, clearcoat 1, rugosità 0,32, 2 lenti;
Audi → `carpaint` con mappa blu (tinta nello shader); Defender → `Body Paint`
con mappa 4K; slider → etichetta 50% e `localStorage` `0.5`.

**Non verificato**: una GPU vera non c'è su questa macchina, quindi resta da
guardare a schermo il colore delle auto dopo la tinta e le montagne lontane
all'orizzonte.

## 26/10 — Fase 0: banco prova riproducibile e misure di partenza

Prima di toccare il paesaggio è stato costruito il banco prova richiesto dal
brief (`?bench=1` + `scripts/bench.mjs`). Serve a confrontare prima/dopo ogni
fase con la stessa inquadratura, la stessa ora e lo stesso meteo, su GPU vera.

### Come si usa

```bash
# server già attivo (npm run dev, oppure npm run preview)
npm run bench -- --quality medium --out captures/fase-a/prima
npm run bench -- --quality low    --out captures/fase-a/prima-low
# solo misure, 20 s per vista, tre viste di default
```

- `?bench=1` spegne HUD e input, blocca ora 16:00 e meteo sereno, disattiva la
  degradazione adattiva e usa `rise/run` di camera fissi. **Non cambia il
  rendering**: il percorso di draw è quello normale.
- `scripts/bench.mjs` lancia Chromium **con GPU hardware** (`--use-angle=d3d11`,
  niente SwiftShader) via CDP, stampa la stringa del renderer e salva
  `results.json` + uno screenshot per vista. Richiede un Chromium installato:
  Chrome, Brave o Edge. Su questa macchina usa Brave.
- Le pose sono in `BENCH_VIEWS` (`src/game.ts`); le coordinate sono state scelte
  dai dati OSM/DEM con `scripts/bench-analyze.mjs`:
  1. **Strada di campagna** — SS 157 della Valle del Biferno a ~1 km da Palata,
     tratto con pendenza laterale ~2,5 m su 20 m e campi aperti, camera
     inseguitrice a 8,8 m. La posa è ferma per riproducibilità, ma auto e camera
     sono quelle della vista a 80 km/h.
  2. **Crinale aperto** — 2.377,4 / −1.842,8, ~1.575 m a est di Palata, 535 m
     slm, 34 m dalla strada più vicina e 55 m dalla casa più vicina. Sguardo
     verso Palata.
  3. **Piazza del Popolo** — centro OSM della piazza a Palata (865,8 / −2.298,2),
     sguardo verso le case e la direttrice della chiesa.
- Gli fps minimi sono medie su finestre da 1 s (non il singolo frame), perché
  uno stutter di streaming non dice niente sulla fluidità percepita. La memoria
  texture è `renderer.info.memory.textures` (conteggio) + una stima dei byte
  delle immagini di scena; i render target del post-processing sono esclusi.

### Verifica su GPU vera

Renderer letto dal driver in Brave headless con GPU hardware:

```
ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-45 GPU (0x37314430)
       Direct3D11 vs_5_0 ps_5_0, D3D11)
```

Quindi le misure qui sotto sono **renderizzate dalla GPU vera**, non da
SwiftShader. Resta un limite: la finestra headless non è quella che vede
l'utente, e le misure possono variare di ~20% con carico di background e stato
termico della macchina. Per questo ogni fase avrà un "prima" e un "dopo"
eseguiti uno dietro l'altro nelle stesse condizioni, oltre ai numeri di
riferimento salvati qui.

### Misure di partenza (20 s per vista, 1280×800, DPR 1)

| Preset | Vista | fps medi | fps min 1 s | draw call | triangoli | texture (stima MB) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `minimal` | strada | 100,6 | 90,4 | 131 | 2,63 M | 84 (~209) |
| `minimal` | crinale | 102,2 | 96,7 | 217 | 2,95 M | 110 (~209) |
| `minimal` | piazza | 102,5 | 98,9 | 96 | 2,61 M | 121 (~209) |
| `low` | strada | 50,5 | 40,6 | 295 | 4,60 M | 129 (~251) |
| `low` | crinale | 50,3 | 42,3 | 373 | 5,30 M | 159 (~248) |
| `low` | piazza | 54,0 | 41,9 | 297 | 4,58 M | 172 (~248) |
| `medium` | strada | 26,7 | 23,6 | 343 | 11,89 M | 146 (~395) |
| `medium` | crinale | 24,3 | 21,4 | 422 | 13,09 M | 179 (~416) |
| `medium` | piazza | 24,9 | 20,4 | 353 | 12,99 M | 198 (~416) |
| `high` | strada | 16,2 | 12,5 | 772 | 36,23 M | 195 (~456) |
| `high` | crinale | 15,9 | 15,8 | 915 | 36,96 M | 215 (~490) |
| `high` | piazza | 15,8 | 15,7 | 782 | 36,81 M | 238 (~490) |

Screenshot: `captures/baseline/<preset>/<road|hilltop|piazza>.png`; dati
completi in `captures/baseline/<preset>/results.json`.

Osservazioni oneste:

- Su questa iGPU `medium` sta già a ~25 fps e `high` a ~16 fps: il margine del
  -10% è **1–2 fps**, quindi ogni fase andrà misurata prima/dopo e, se il costo
  reale sfonda, si riduce la densità del preset (come da brief), non si toglie
  la funzione.
- `high` paga soprattutto ombre e post-processing: 36,9 M triangoli contro
  13,1 M di `medium` e 915 draw call contro 422. È il primo posto da guardare
  se una fase sfora.
- `minimal` e `low` hanno molto margine; i nuovi shader dovranno comunque
  restare dietro un interruttore di preset.
- La strada di campagna mostra già il problema noto della Fase C: marciapiedi e
  cordoli su una provinciale fuori paese. Non è stato toccato in Fase 0.
