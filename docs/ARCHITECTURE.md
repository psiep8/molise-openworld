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

Le impronte OSM vengono estrose con `ExtrudeGeometry`, con base affondata di 70 cm per non galleggiare sui pendii, e tetto piatto in laterizio con 4.5% di sporto. Colori di muri/tetti scelti da palette e hash deterministico dell'edificio, quindi stabili tra un avvio e l'altro.

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

`PostPipeline` (`src/gfx/post.ts`) incatena `RenderPass → UnrealBloom → SMAA → OutputPass`.
Il bloom è volutamente debole (soglia 0.82) e serve a far respirare cielo e tetti; `OutputPass`
applica tone mapping e color space corretti sul render target lineare. Se il preset è
`low`/`medium` la pipeline viene saltata e si renderizza diretto.

`src/gfx/quality.ts` definisce quattro preset (`low`, `medium`, `high`, `ultra`) con
`pixelRatio`, dimensione shadow map, post-processing e zoom massimo delle tile satellite.
Il preset iniziale è scelto da `hardwareConcurrency`/`deviceMemory`/user agent, può essere
forzato con `?quality=` e viene salvato in `localStorage`. In più `Game` applica un
**resolution scaling adattivo**: se gli fps scendono sotto 34 il pixel ratio scende fino a
0.65×, se risalgono sopra 56 torna a 1×.

Le superfici vicine (asfalto, sterrato, intonaco, coppi) usano texture canvas generate da
`surface-textures.ts`, moltiplicate dai vertex color: zero asset esterni, grana e giunti
visibili da vicino. Le UV delle strade sono in metri (una tile ogni ~6 m).

## 11. Audio procedurale

`GameAudio` (`src/audio/audio.ts`) sintetizza tutto con WebAudio: vento e rotolamento da
rumore filtrato, motore con due oscillatori saw e lowpass, passi con burst di rumore
filtrati, uccelli con chirp sinusoidali. Il contesto parte solo al primo gesto utente
(click sul pulsante di avvio), segue velocità e modalità, e si silenzia con `N`.

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
pioggia o neve (`precipitation.ts`); visibilità/nebbia → `Fog.near/far`; elevazione del
sole → colore e intensità della luce, luce lunare di riempimento, esposizione. Il pannello
`P` salva la scelta in `localStorage` (`molise.realWeather`) e mostra condizioni, alba e
tramonto. Spegnendo lo switch si ripristinano cielo, luci e nebbia di default.

I test in `tests/weather.test.ts` verificano la posizione del sole a equinozio, giugno e
dicembre a Palata e la traduzione dei codici WMO.

## 13. Perché niente GTA V

Il progetto prende ispirazione dal *tipo* di esperienza (open world, guida, esplorazione), non dai contenuti. Non c'è reverse engineering di binari o asset Rockstar: il "reverse engineering" qui è quello dei **formati geografici aperti** (tile mercator, DEM Terrarium, tag OSM), reimplementati in un motore proprio. È la strada legale e, per una mappa del proprio paese, anche la più interessante: i dati della tua zona sono già lì.
