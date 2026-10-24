# Architettura

Questo documento spiega come sono stati reimplementati, in modo originale, i "fondamentali" di un open-world (camminare, guardarsi intorno, guidare su una mappa) partendo da dati geografici aperti.

## 1. Da lat/lon al mondo di gioco

Tutto il mondo vive in un sistema locale in metri:

- `x` = est, `z` = sud, `y` = quota (convenzione Three.js, avanti = `-z`);
- origine al centro del bbox dei cinque comuni;
- proiezione equirettangolare locale (raggio di curvatura WGS84 semplificato), errore < 0.1 m sui ~14 km dell'area.

`latLonToWorld` / `worldToLatLon` stanno in `src/config.ts` e devono restare identici alle formule di `scripts/fetch-geodata.mjs`, perché il DEM è pre-campionato su quella griglia.

## 2. Heightfield

`public/geo/heights.json` descrive una griglia regolare da 10 m (`1412 × 1222` campioni, 3.5 MB). `heights.bin` è un `Int16` in decimetri, row-major, con origine in `originX/originZ`.

`Heightfield.heightAt(x, z)` fa interpolazione bilineare con clamp ai bordi; `normalAt` usa differenze centrali (usata per l'assetto di auto e strade) e `slopeAt` per evitare alberi su pareti verticali.

Perché pre-processare? Il browser non deve decodificare 110 PNG Terrarium all'avvio: un fetch + `Int16Array` e il mondo è pronto. Il DEM può essere rigenerato in qualsiasi momento.

## 3. Terreno e streaming

Il mondo è diviso in chunk da 912 m (`CHUNK_SIZE`), circa 2 tile z16.

- Geometria: `PlaneGeometry` 72×72 segmenti, ogni vertice campionato sul DEM. I bordi combaciano perché tutti i chunk usano lo stesso sampler.
- Texture: `ImageryStreamer` compone le tile del provider in una canvas che copre esattamente l'area del chunk. Lo zoom dipende dalla distanza: z18 (≈0.45 m/px) entro 520 m, z17 entro 1.5 km, z16 entro 2.6 km, z15 (≈3.5 m/px) per l'orizzonte. Se una tile manca, resta il verde di fallback.
- Dettaglio progressivo: quando il giocatore si avvicina, il chunk non viene ricostruito; `Terrain.tick` richiede la texture a zoom più alto e la sostituisce, liberando la precedente. Al massimo 5 caricamenti texture sono in volo insieme.
- Normal map: `buildNormalMap` campiona il DEM 128×128 per chunk e scrive una normal map in spazio tangente. Il rilievo fine (crinali, fossi, muretti) resta visibile anche se la mesh ha un passo di ~9.5 m.
- Streaming: `Terrain.update` calcola i chunk nel raggio di 3.1 km ordinati per distanza, ne costruisce 2 per frame e libera quelli fuori raggio.

Le texture e le normal map sono possedute dal chunk: quando il chunk esce, viene fatto `dispose()`. Il browser HTTP cache evita riscarichi se si torna indietro.

## 4. Strade

Le strade OSM sono polilinee. `buildRoads` le ricampiona ogni 6–7 m, calcola la perpendicolare e genera un nastro largo quanto il tipo di strada (`ROAD_WIDTHS`), sollevato di 12–20 cm sopra il DEM e ombreggiato con la normale del terreno.

Tutte le strade finite in un'unica `BufferGeometry` per superficie (asfalto/sterrato): 2 draw call per l'intero mondo. Gli incroci sono sfalsati di pochi millimetri per limitare lo z-fighting.

`RoadIndex` è un hash spaziale di segmenti (cella 140 m) usato per:
- capire se l'auto è su asfalto (più aderenza e velocità);
- evitare di piantare alberi in mezzo alla carreggiata;
- trovare un punto strada per lo spawn e il tasto `R`.

## 5. Edifici

Le impronte OSM vengono estrose con `ExtrudeGeometry`, con base affondata di 70 cm per non galleggiare sui pendii.

- **Tetto a padiglione.** `src/world/roof.ts` è puro: dato il poligono con lo sporto del
  4,5%, calcola un anello di colmo rimpicciolito del 42% verso il baricentro e una falda
  per lato, più il colmo da triangolare. Il rialzo dipende dall'area
  (`clamp(sqrt(area) · 0.16, 1, 3.2)` m). Se il baricentro cade fuori dal poligono
  (impronte a U o molto concave) la funzione restituisce `null` e l'edificio mantiene il
  tetto piatto: meglio un tetto semplice che falde che si incrociano. Il verso delle
  facce viene deciso dalla componente `y` della normale, così il risultato è corretto
  con impronte OSM in senso orario o antiorario.
- **Facciate.** `facadeTexture()` disegna un modulo di 3,3 m con intonaco, cornice,
  telaio in pietra, vetro scuro con riflesso, traversa, davanzale e persiane di legno.
  `ExtrudeGeometry` genera `v = 1 - altezza`, quindi le UV del muro vengono negate per
  raddrizzare la finestra; con `repeat 0.3` e `offset.y = -0.28` la prima fila di
  finestre parte a ~0,9 m dal suolo. La texture è moltiplicata dal vertex color, così
  ogni casa mantiene il suo colore.

Colori di muri/tetti scelti da palette e hash deterministico dell'edificio, quindi stabili tra un avvio e l'altro.

Muri e tetti sono fusi in due sole mesh (`mergeGeometries`), con ombre attive. Le impronte restano anche in `BuildingIndex` per le collisioni: cerchio contro poligono, con push-out lungo il bordo più vicino.

## 6. Vegetazione

Per ogni area `wood/forest/scrub/orchard/park` si campiona una griglia con jitter, si filtra per `pointInPolygon`, pendenza < 34°, distanza da strade ed edifici. Il PRNG `mulberry32` con seed fisso rende il bosco riproducibile.

Due `InstancedMesh` (tronchi e chiome) per un massimo di 7000 alberi: 2 draw call.

## 7. Camminata

`Player` è un controller a velocità con accelerazione esponenziale, gravità e salto. La quota segue il terreno quando è a terra; in aria integra la velocità verticale.

- Collisioni: cerchio di 42 cm risolto contro `BuildingIndex`.
- Avatar low-poly con gambe/braccia animate in base alla velocità.
- Camera: prima persona (pitch/yaw dal mouse, bob leggero) o terza persona con camera orbitale arretrata e clamp sopra il terreno.

## 8. Auto

La fisica è in `src/sim/car.ts`, **pura** (nessun import Three.js), quindi testabile e deterministica:

- modello bicycle: `yawRate = v / wheelbase · tan(steer)`;
- sterzo massimo ridotto all'aumentare della velocità;
- accelerazione, frenata, retromarcia, resistenza lineare + quadratica;
- pendenza: differenza di quota davanti/dietro → accelerazione gravitazionale lungo l'asse;
- superficie: fuori strada max speed × 0.62, sterzo leggermente più nervoso;
- freno a mano: decelerazione forte e yaw rate × 1.9.

Il mesh dell'auto è procedurale (carrozzeria, abitacolo, portapacchi, fari). Ogni frame si campionano 4 punti di contatto per ricavare quota media, pitch e roll, con smoothing esponenziale. Le ruote anteriori sterzano, tutte rotolano.

Camera in guida: chase camera con lerp, orbita col mouse e zoom con la rotella.

## 9. Mappa

`MapRenderer` ha due livelli:

- **radar satellite** (predefinito): `SatelliteTiles` scarica e mette in cache le tile Esri z17 intorno al giocatore e le disegna nella minimappa; `SatelliteBasemap` compone un mosaico z14 dell'intera area per la mappa grande. Sopra la foto restano le strade OSM (in crema) e i toponimi, con Palata marcata come "casa".
- **mappa vettoriale**: la mappa statica 1600 px (aree, edifici, strade) pre-calcolata una sola volta, usata come fallback offline e con il tasto `V`.

La minimappa ridisegna solo ciò che cade nei 780 m intorno al giocatore, con nord in alto; la mappa grande mostra l'intera valle con i marker live.

## 10. Post-processing e qualità

`PostPipeline` (`src/gfx/post.ts`) incatena `RenderPass → UnrealBloom → SSAO → SMAA → OutputPass`.
Il bloom è volutamente debole (soglia 0.82) e serve a far respirare cielo e tetti; `OutputPass`
applica tone mapping e color space corretti sul render target lineare. L'occlusione ambientale
(`SSAOPass`, kernel 16 campioni, raggio ~0,6 m) si attiva solo su `high`/`ultra` e si spegne
con gli altri preset. Se il preset è `low`/`medium` la pipeline viene saltata e si renderizza
diretto.

`src/gfx/quality.ts` definisce **cinque** preset (`minimal`, `low`, `medium`, `high`,
`ultra`). Ognuno non è solo una manopola di rendering: descrive **quanto mondo esiste**.

| Campo | Effetto |
| --- | --- |
| `pixelRatio`, `renderScaleFloor`, `antialias` | risoluzione, scala minima adattiva, MSAA del contesto (fissato alla creazione) |
| `shadows`, `shadowMapSize` | passata d'ombra, la più cara |
| `post`, `bloom`, `ssao` | pipeline di post-processing (creata solo se il preset la usa) |
| `maxSatelliteZoom`, `viewRadius` | tile satellite e chunk di terreno tenuti in memoria |
| `trees`, `shrubs`, `pedestrians`, `grassDensity`, `pointLights` | densità di scena |
| `weather`, `kit`, `drainage`, `buildingDetail` | effetti e asset che si possono saltare del tutto |

`minimal` è il preset di compatibilità: niente ombre, erba, pedoni, meteo, post-processing,
GLB del kit né chiusini, facciate semplificate (muri, tetti, cornicione, comignolo,
portone e vetri), 2.200 alberi, terreno a 1,5 km e tile z15. `low` è la fascia dei portatili
con grafica integrata. `medium` riporta il mondo pieno senza post-processing. `high` e
`ultra` aggiungono bloom, SSAO, ombre degli alberi e dettaglio massimo.

Il preset iniziale viene scelto da `classifyQuality()` (funzione pura, testata) usando la
stringa della GPU, i core e la memoria dichiarata dal browser: rendering software →
`minimal`, GPU integrate → `low` (o `medium` con 8+ core/8 GB), GPU dedicate → `high`. Può
essere forzato con `?quality=` e viene salvato in `localStorage` (`molise.quality`). Se il
browser non riesce ad aprire WebGL2, `main.ts` mostra un messaggio comprensibile invece
di una pagina nera.

`Game` adatta il costo a runtime in due fasi. Prima il **resolution scaling**: sotto i 34
fps il pixel ratio scende fino a `renderScaleFloor` del preset, sopra i 56 torna su. Se
anche il minimo non basta (tre controlli consecutivi sotto i 26 fps), scatta una
**degradazione a gradini**, permanente per la sessione: ombre off → erba off → meteo e
fusione off (z15) → raggio del terreno a 1,6 km → scala 0,5× e raggio a 1,2 km. Cambiare
preset a mano azzera i gradini. `window.__molise` espone `degraded`, `drawCalls`,
`triangles` e `gpu` per sapere cosa sta succedendo.

Il composer di post-processing viene costruito alla prima richiesta, non all'avvio: sui
preset bassi non occupa VRAM. `buildBuildings` accetta `detail: 'simple'`, che tiene la
sagoma delle case e rinuncia a cornici, davanzali, persiane, pluviali, cantonali e balconi
(oltre due milioni di triangoli su 2.200 case). I cartelli stradali usano un palo
cilindrico procedurale al posto della parte del kit da 28.000 triangoli. Tutto questo è
misurato in `scripts/smoke.mjs` (`SMOKE_QUALITY=minimal`, draw call e triangoli in
`window.__molise`).

Le superfici usano texture PBR fotografiche CC0 (Poly Haven + ambientCG) raccolte in
`public/textures/` da `scripts/fetch-textures.mjs` (`npm run textures`): colore in sRGB,
normal e roughness lineari, `opacity` per le foglie. `src/gfx/textures.ts` è l'unico punto
che carica e mette in cache i set (`pbr`, `pbrColor`, `foliageSet`, `waterNormals`); se un
file manca, il materiale resta valido col solo colore/vertex color. Le vecchie texture
canvas di `surface-textures.ts` restano per i casi senza asset (intonaco di fallback).
Le UV delle strade sono in metri (una tile ogni ~6 m).

Le animazioni di superficie stanno in `src/gfx/wind.ts`: un registro condiviso con lo
uniform `uTime` del vento (chiome e ciuffi d'erba, iniettato in `onBeforeCompile`) e le
texture da far scorrere (normali dell'acqua). `Game.update` chiama `updateWind(dt)` una
volta per frame.

Strade: `buildRoads` drappeggia tre nastri (asfalto, sterrato, cemento). Marciapiedi e
cordoli esistono solo sulle strade asfaltate e vengono spezzati davanti agli incroci con
`RoadIndex.isOnRoad`, per non attraversare l'altra carreggiata. L'acqua usa normali
fotografiche scorrevoli (nastri veloci, laghi lenti) e un materiale fisico con clearcoat.
La vegetazione unisce corteccia PBR sui tronchi, card fotografiche con `alphaMap` e vento
nei vertici; i prati sono ciuffi istanziati con una texture di lame disegnata su canvas
(`alphaTest`, niente ordinamento) e lo stesso vento.

## 11. Audio procedurale

`GameAudio` (`src/audio/audio.ts`) sintetizza tutto con WebAudio: vento e rotolamento da
rumore filtrato, motore con due oscillatori saw e lowpass, passi con burst di rumore
filtrati, uccelli con chirp sinusoidali. Il motore non è più generico: `engineVoice(spec)`
legge cilindri e regimi dalla scheda del veicolo e il sintetizzatore usa la frequenza di
accensione reale (`rpm/60 × cilindri/2`), con filtro e guadagno che seguono il carico.
Il contesto parte solo al primo gesto utente (click sul pulsante di avvio), segue velocità
e modalità, e si silenzia con `N`.

## 12. Meteo reale e sole

`src/world/weather.ts` tiene insieme due cose che funzionano anche separatamente:

- **Sole reale.** `sunPosition(date, lat, lon)` implementa la formula NOAA semplificata
  (longitudine media, anomalia, obliquità, ascensione retta, angolo orario) e restituisce
  elevazione e azimut da nord. Il gioco converte l'azimut nel sistema di Three.js
  (`theta = 180 - azimut`) e aggiorna la direzione del sole in `SkyRig`, quindi la luce
  e le ombre seguono l'ora vera del punto in cui si trova il giocatore. Funziona offline.
- **Meteo.** `fetchWeather` chiama Open-Meteo (`/v1/forecast`, `current` + `daily`),
  servizio open source senza chiave e con CORS. `RealWeather` gestisce auto-refresh ogni
  10 minuti, timeout di 9 s, abort delle richieste precedenti e retry dopo 2 minuti in
  caso di errore. Se la rete manca, `snapshot` resta l'ultimo dato (o `defaultWeather()`)
  e il sole reale continua a funzionare.

`Game.applyWeatherVisuals` traduce il dato in atmosfera: copertura nuvolosa → cupola
procedurale (`clouds.ts`) e turbidity/rayleigh del cielo; precipitazione e temperatura →
pioggia o neve (`precipitation.ts`, con schizzi sul terreno vero) e banchi di foschia
bassa (`mist.ts`, più densi all'alba/tramonto e con la nebbia); visibilità/nebbia →
`Fog.near/far`; elevazione del sole → colore e intensità della luce, luce lunare di
riempimento, esposizione. La cupola visiva e la cubemap PMREM condividono
`skyRadiance` (0,55) perché lo shader Preetham in HDR altrimenti brucia l'orizzonte;
`environmentIntensity` viene compensato per non spegnere i materiali PBR. Il pannello
`P` salva la scelta in `localStorage` (`molise.realWeather`) e mostra condizioni, alba
e tramonto. Spegnendo lo switch si ripristinano cielo, luci e nebbia di default.

I test in `tests/weather.test.ts` verificano la posizione del sole a equinozio, giugno e
dicembre a Palata e la traduzione dei codici WMO.

## 13. Perché niente GTA V

Il progetto prende ispirazione dal *tipo* di esperienza (open world, guida, esplorazione), non dai contenuti. Non c'è reverse engineering di binari o asset Rockstar: il "reverse engineering" qui è quello dei **formati geografici aperti** (tile mercator, DEM Terrarium, tag OSM), reimplementati in un motore proprio. È la strada legale e, per una mappa del proprio paese, anche la più interessante: i dati della tua zona sono già lì.

## 14. Itinerario sulla mappa

L'itinerario vive in `src/sim/routing.ts`, **puro** (niente Three.js, niente DOM),
quindi testato in `tests/routing.test.ts`.

- **Grafo.** Le polilinee OSM diventano un grafo una sola volta all'avvio: i vertici
  sono indicizzati per cella da 4 m, così due way che si toccano in un incrocio
  condividono il nodo anche se arrivano da relazioni diverse. Gli archi sono le
  distanze reali in metri, in entrambe le direzioni, salvate in formato CSR
  (`offsets`/`targets`/`costs`) per non allocare oggetti durante la ricerca.
- **Costo.** Ogni arco è moltiplicato per una penalità per tipo di strada: 1.0-1.1
  per asfalto e strade urbane, 1.45 per le sterrate, 2.4 per sentieri e marciapiedi.
  Così l'asfalto vince anche quando il sentiero è più corto.
- **Ricerca.** A* con euristica euclidea scalata a 0.9 (il fattore minimo fra le
  strade), heap binario indicizzato per nodo, `closed` in `Uint8Array`.
- **Snapping.** Partenza e arrivo sono agganciati al nodo più vicino; la polilinea
  restituita include i due tratti di avvicinamento, quindi la distanza mostrata è
  quella che si percorre davvero.

**Lato gioco.** Il click sulla mappa grande passa da `worldFromBigMap` (l'inverso di
`toStaticScreen`); `Game.setDestination` calcola il piano e la stessa polilinea viene
disegnata in ciano sulla minimappa e sulla mappa grande, con una colonna di luce
sulla destinazione. L'itinerario si ricalcola quando ci si allontana di oltre 60 m
dal punto di partenza e si annulla con `X`; `window.__molise.route` espone distanza
ed etichetta per smoke test e diagnostica.
