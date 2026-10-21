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
- Texture: `ImageryStreamer` compone le tile del provider in una canvas che copre esattamente l'area del chunk. Zoom 16 (≈1.8 m/px) lontano, zoom 17 (≈0.9 m/px) entro `DETAIL_RADIUS`. Se una tile manca, resta il verde di fallback.
- Streaming: `Terrain.update` calcola i chunk nel raggio di 3.1 km ordinati per distanza, ne costruisce 2 per frame e libera quelli fuori raggio.

Le texture sono possedute dal chunk: quando il chunk esce, viene fatto `dispose()`. Il browser HTTP cache evita riscarichi se si torna indietro.

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

`MapRenderer` pre-calcola una mappa statica 1600 px (aree, edifici, strade) una sola volta. La mappa grande disegna quell'immagine + marker live; la minimappa ridisegna solo le strade visibili nei 780 m intorno al giocatore, con nord in alto.

## 10. Perché niente GTA V

Il progetto prende ispirazione dal *tipo* di esperienza (open world, guida, esplorazione), non dai contenuti. Non c'è reverse engineering di binari o asset Rockstar: il "reverse engineering" qui è quello dei **formati geografici aperti** (tile mercator, DEM Terrarium, tag OSM), reimplementati in un motore proprio. È la strada legale e, per una mappa del proprio paese, anche la più interessante: i dati della tua zona sono già lì.
