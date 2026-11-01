# F14–F15 — Mappe e interfaccia

Report delle modifiche a minimappa, mappa grande e legenda. Riferimenti al
codice: [src/ui/minimap.ts](../src/ui/minimap.ts), [src/ui/satellite.ts](../src/ui/satellite.ts),
[src/ui/map-scale.ts](../src/ui/map-scale.ts), [index.html](../index.html),
[src/style.css](../src/style.css).

## F14 — minimappa

| Richiesta | Stato | Dove |
| --- | --- | --- |
| Canvas ad alta densità | fatto prima di questo giro: `cssSize × min(dpr, 2.5)` | `resizeSquare` |
| Zoom 1:1 con i pixel e prefetch | fatto prima di questo giro: `zoomForScale` sceglie `ceil` e si chiede in anticipo il livello successivo | `satellite.ts` |
| Cache, dedup, priorità, retry, offline | fatto prima: 260 tile, 6 richieste in volo, retry 20 s, mosaico `world-imagery-hd.jpg` sotto le tile | `SatelliteTiles` |
| Nitidezza delle tile | **corretto qui**: le tile erano disegnate a `-0,5 px` e `+1 px` per coprire le cuciture, quindi ricampionate di mezzo pixel. Ora gli angoli si agganciano ai pixel interi: stesso bordo per tile confinanti (nessuna fessura) e nessun ricampionamento | `SatelliteTiles.drawLevel` |
| Strade con cornice e spessore per classe | fatto: `ROAD_STYLE` a quattro ranghi, due passate (cornice, poi riempimento) | `minimap.ts` |
| Freccia giocatore, bordo, ombra, scala | fatto prima: freccia con alone e bordo, cerchio con ombra, barra di scala | `drawMinimap` |
| Attribuzione del provider | fatto: legenda (`#map-attribution`) e `© provider` disegnato sulla minimappa quando è attivo il radar | `game.ts`, `minimap.ts` |
| Unsharp a zoom alto | **non necessario**: con le tile a 1:1 il canvas è già alla risoluzione nativa; un filtro per frame costerebbe e sfocherebbe i bordi, che ora sono netti | — |

Nota sulle tile: `VITE_OPEN_IMAGERY_TILE_URL` è vuoto per scelta (vedi
[README](../README.md), sezione attribuzioni). Senza un provider aperto
configurato il radar non ha tile vere, quindi la minimappa resta vettoriale —
disegnata alla risoluzione del canvas, quindi più nitida del mosaico Sentinel
ingrandito 30×. `V` lo dice esplicitamente con un toast.

## F15 — mappa vettoriale

- **Gerarchia stradale** per classe OSM (`primary`/`secondary`/`residential`/`track`)
  con colore, spessore e cornice; le sterrate sono tratteggiate e più tenui.
- **LOD cartografico** sulla minimappa: oltre 520 m solo principali, sotto 330 m
  secondarie, sotto 340 m compaiono gli edifici; in paese anche i nomi delle vie.
- **Corsi d'acqua lineari** (nuovo): `waterway` OSM come polilinee, sotto le
  strade: fiumi sempre, torrenti fino a 520 m, fossi solo da vicino. Prima
  esistevano solo le aree d'acqua, e la valle del Biferno non si leggeva.
- **Hillshade** dal DEM (320 px, luce da nord-ovest, `soft-light` al 50%) sotto
  la carta: dà l'orientamento delle valli senza colorare la mappa.
- **Etichette senza collisioni**: rettangolo occupato per ogni nome; i paesi
  hanno priorità, poi i POI, poi le vie (ruotate lungo il tratto, fino a 14 sulla
  mappa grande e 2 sulla minimappa). Niente nomi stampati uno sopra l'altro.
- **Cluster dei POI** (nuovo): sulla mappa grande le nove attività di Palata
  cadono entro una trentina di pixel; ora chi sta entro 22 px finisce in un badge
  con il numero e l'etichetta `N POI`, mentre i POI isolati restano singoli con
  il nome. `clusterByRadius` è pura ed è coperta da test.
- **Livelli on/off** in legenda: Strade, Aree, Edifici, POI, Nomi; ogni cambio
  rigenera la base statica e ridisegna la mappa grande.
- **Edifici tenui** sulla minimappa (era il difetto principale in paese): erano
  pieni al 78%, il paese diventava un blocco beige e le vie sparivano; ora 46%
  con bordo al 42%.
- **Palette e leggibilità**: verde-oliva di fondo, strade chiare, acqua
  blu-verde, POI colorati per categoria; scala in metri, nome del paese sotto
  la mappa, case e garage con icone proprie.

## Verifica

Eseguito in locale con il dev server (`?quality=low&autostart=drive`):

- `tsc --noEmit`: passa.
- `vitest run tests/map-scale.test.ts`: 9 test passati (5 preesistenti + 4 nuovi
  sul cluster).
- Mappa grande: strade, nomi ruotati, nomi dei paesi, hillshade, acqua, badge
  `9 POI` sotto Palata, legenda con i cinque livelli e attribuzione. Con
  «Strade» spento la base viene rigenerata senza strade e restano aree, acqua e
  rilievo (screenshot: [big map](../screenshots/map-big-after.png),
  [strade spente](../screenshots/map-roads-off.png)).
- Minimappa in paese a 240 m: edifici tenui, vie leggibili, freccia, barra di
  scala, etichette dei POI (screenshot: [minimappa](../screenshots/minimap-town-after.png)).
- Nessun errore di shader in console dopo il reload (vedi sotto).

Non verificato in questo ambiente: fps reali (la VM non ha GPU e gira a 0,5 fps
in software), comportamento del radar con un provider di tile configurato, e
misura del tempo di arrivo delle tile alte. Restano da fare, se si vuole:
minimappa heading-up opzionale e un `V` che spieghi anche la licenza del provider.

## Bug trovato durante la verifica

Con il browser aperto è emerso che lo shader dell'asfalto **non compilava**:
`ERROR: uRoadWet : redefinition`. Il materiale dell'asfalto del citykit dichiara
già `uniform float uRoadWet;`; `applyRoadWear` concatena il suo `onBeforeCompile`
e ridichiarava la stessa uniform, quindi il programma veniva rifiutato e le
strade restavano senza materiale. Ora le dichiarazioni preesistenti delle
uniform del tempo vengono rimosse prima di inserire il blocco della strada
([roads.ts](../src/world/roads.ts)). Dopo il reload la console non riporta più
errori di compilazione e l'asfalto si vede.
