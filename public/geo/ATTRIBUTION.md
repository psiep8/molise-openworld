# Attribuzione dei dati geografici

Questa cartella contiene i dati con cui è costruito il mondo. Ogni file ha una
licenza diversa: se ridistribuisci il progetto, mantieni le attribuzioni qui
sotto.

| File | Fonte | Licenza |
| --- | --- | --- |
| `osm.json` | [OpenStreetMap](https://www.openstreetmap.org/) — strade, edifici, aree, toponimi | © OpenStreetMap contributors, **ODbL 1.0**. È un'opera derivata: resta ODbL. |
| `heights.bin`, `heights.json` | [AWS Terrain Tiles (Terrarium)](https://registry.opendata.aws/terrain-tiles/) — DEM SRTM/Copernicus/NASADEM | dati aperti, attribution secondo il registry |
| `world-imagery.jpg`, `world-imagery.json` | [Sentinel-2 cloudless 2025](https://s2maps.eu) — © EOX IT Services GmbH | **CC BY 4.0**; contiene dati Copernicus Sentinel modificati |

## Copertura del suolo (non nel repo)

`public/geo/landcover/` è un'opera derivata: non è versionata e si rigenera con
`npm run landcover`. Contiene la fusione di WorldCover, OSM e DEM descritta
sotto; senza questi file il gioco parte lo stesso con il vecchio terreno.

| File | Fonte | Licenza |
| --- | --- | --- |
| `public/geo/landcover/*.png`, `meta.json` | [ESA WorldCover 10 m 2021 v200](https://esa-worldcover.org/) + [OpenStreetMap](https://www.openstreetmap.org/) + `heights.bin` | **CC BY 4.0** (WorldCover); **ODbL 1.0** (OpenStreetMap); opera derivata ODbL |
| `public/textures/ploughed/`, `public/textures/woodland/` | [Poly Haven](https://polyhaven.com/) (`farm_furrows`, `forest_ground_05`) | **CC0 1.0** |

Il tile WorldCover usato è
`ESA_WorldCover_10m_2021_v200_N39E012_Map.tif`; lo script lo scarica una volta
in `.geo-cache/worldcover/`. Il dettaglio è a 2 m/px per chunk (456×456 RGBA8),
la mappa di riserva a 12 m/px.

## Immagini di dettaglio (streaming, non nel repo)

- **Esri World Imagery** — © Esri, Maxar, Earthstar Geographics. Usata per una
  demo non commerciale con attribuzione. Per una pubblicazione serve un provider
  con licenza esplicita: si cambia `ESRI_WORLD_IMAGERY` in
  `src/world/imagery.ts`.

## Come si rigenerano

```bash
npm run geo          # OSM + DEM
npm run geo:imagery  # mosaico Sentinel-2 dell'intero bbox
npm run landcover    # copertura del suolo per il terreno (Fase A)
```
