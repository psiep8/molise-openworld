# Attribuzione dei dati geografici

Questa cartella contiene i dati con cui è costruito il mondo. Ogni file ha una
licenza diversa: se ridistribuisci il progetto, mantieni le attribuzioni qui
sotto.

| File | Fonte | Licenza |
| --- | --- | --- |
| `osm.json` | [OpenStreetMap](https://www.openstreetmap.org/) — strade, edifici, aree, toponimi | © OpenStreetMap contributors, **ODbL 1.0**. È un'opera derivata: resta ODbL. |
| `heights.bin`, `heights.json` | [AWS Terrain Tiles (Terrarium)](https://registry.opendata.aws/terrain-tiles/) — DEM SRTM/Copernicus/NASADEM | dati aperti, attribution secondo il registry |
| `world-imagery.jpg`, `world-imagery.json` | [Sentinel-2 cloudless 2025](https://s2maps.eu) — © EOX IT Services GmbH | **CC BY 4.0**; contiene dati Copernicus Sentinel modificati |

## Immagini di dettaglio (streaming, non nel repo)

- **Esri World Imagery** — © Esri, Maxar, Earthstar Geographics. Usata per una
  demo non commerciale con attribuzione. Per una pubblicazione serve un provider
  con licenza esplicita: si cambia `ESRI_WORLD_IMAGERY` in
  `src/world/imagery.ts`.

## Come si rigenerano

```bash
npm run geo          # OSM + DEM
npm run geo:imagery  # mosaico Sentinel-2 dell'intero bbox
```
