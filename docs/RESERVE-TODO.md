# World kit — riserve chiuse

Stato al **29 ottobre 2026**. Il world kit ha **181 modelli** (78,6 MiB):
**165 `usage: "placed"`** e **16 `usage: "retired"`**. Non restano `reserve`:
ogni modello o entra in scena con un ruolo vero, oppure è archiviato con un
motivo esplicito nel manifest (`retiredReason`). `loadWorldKit()` carica solo
`placed`: i ritirati non pesano su VRAM, memoria o tempo di avvio.

## Cosa è cambiato in quest'ultima fase

| Modello | Ruolo | Dove finisce |
| --- | --- | --- |
| `bridge-modular` | `bridge` | Conci da 20 m su tutte le campate OSM, `world/bridge-kit.ts` |
| `bridge-highway` | `bridge` | Viadotto sulla campata più lunga, **solo** build non commerciale |
| `clover-planter` | `planter` | Due fioriere davanti alla chiesa, `world/piazza.ts` |
| `lampione-da-sentiero` | `pathlight` | Due lampioni sul fondo della piazza |

Gli altri 16 modelli sono ritirati con una motivazione nel manifest e nella
tabella in fondo. I file restano nel repository come archivio: non vengono
caricati da nessun preset. Se un giorno si vorrà recuperarne uno, basta
riprocessarlo e riportarlo a `placed` con un test.

## Ponti OSM: come sono collegati

`world/roads.ts` disegna già l'impalcato procedurale alla quota interpolata fra
le testate (`bridgeElevations`, franco `BRIDGE_CLEARANCE`). Quella resta
l'unica superficie con quota, fisica e collisioni: l'auto non guida sul GLB.

`buildBridgeKit()` legge `osm.roads` con `bridge === true`, ricampiona la
spline con `roadPolyline()`, calcola le quote con `bridgeElevations()` e stende
i moduli lungo la campata:

- **`bridge-modular`**: nodo `Plane.001_1` (three lo carica come `Plane001_1`,
  perché `GLTFLoader` toglie i punti dai nomi: il carica prova entrambi), concio
  20 × 2,48 × 4,69 m, piano stradale a **2,07 m** sopra la base normalizzata. Si
  allunga/allarga con `scaleX`/`scaleZ` per coprire la campata e la carreggiata;
  il piano resta 3 cm sotto l'asfalto procedurale, così il nastro resta la
  superficie di guida.
- **`bridge-highway`**: viadotto 10 × 20,21 × 20 m, piano a **19,31 m** sopra
  la base. Entra solo se il file è caricato (build non commerciale) e solo sulla
  campata più lunga, quando il budget la copre interamente.
- I moduli seguono la tangente della spline (`atan2(-tz, tx)` per l'asse X,
  `atan2(tx, tz)` per l'asse Z), quindi in curva restano accostati.
- Budget per preset (`quality.bridges`, in conci da 20 m): `minimal`/`low` 0,
  `medium` 80, `high` 180, `ultra` 420. I ponti si ordinano per distanza dalla
  casa e si piazzano interi: niente campate a metà. A `medium` gli 80 moduli
  coprono le campate fino a ~7 km e costano ~0,57 M triangoli su ~45 M.

A `medium`/`high` il viadotto più lungo (4,8 km, SS647) non entra nel budget e
resta con la sola struttura procedurale; a `ultra` viene coperto dal modulo
`bridge-highway`. Nella build commerciale `bridge-highway` non viene nemmeno
scaricato e il ponte usa `bridge-modular`.

## Licenze

- **CC BY 4.0**: attribuzione obbligatoria, già in `public/worldkit/ATTRIBUTION.md`.
- **CC BY-NC 4.0** (`bridge-highway`, `field-tall-green`): esclusi quando
  `VITE_COMMERCIAL_BUILD=1`. `bridge-highway` è l'unico NC ancora piazzato.
- **CC BY-SA 4.0** (`passerella`, `strada-innevata`): ritirati. Non ci sono
  opere derivate da distribuire con share-alike.
- **Sketchfab Standard**: mai stato ridistribuito.

## Ritirati

Tutti hanno `usage: "retired"` e `retiredReason` nel manifest.

| Slug | Licenza | Motivo |
| --- | --- | --- |
| `terreno` | CC BY 4.0 | Scan di 78 km, non riproiettabile sul DEM |
| `terreno-grande` | CC BY 4.0 | Mesh unica 2,5 × 2 km, senza reprojection/LOD |
| `terreno-di-strada` | CC BY 4.0 | Striscia di 12 km da fondale, non zolla giocabile |
| `terreno-fng` | CC BY 4.0 | Zolla 4 m con 28k triangoli, più pesante delle `ground` |
| `tracce-nel-fango` | CC BY 4.0 | 32k triangoli per 4,5 m: il fango procedurale costa meno |
| `cerchi-di-pioggia` | CC BY 4.0 | VFX superato da `Precipitation` |
| `neve-che-cade` | CC BY 4.0 | VFX superato dalla neve particellare |
| `chiesa-venezia` | CC BY 4.0 | Landmark di Venezia fuori contesto |
| `via-s-gemini` | CC BY-NC 4.0 | Non commerciale e scan di una via di Viterbo |
| `infrastruttura-urbana` | CC BY 4.0 | Mappa urbana 2,6 × 2,9 km, non un prop |
| `scena-di-bosco` | CC BY 4.0 | Scena 87 × 54 m, sostituita dagli alberi istanziati |
| `svincolo-autostradale` | CC BY 4.0 | Svincolo 199 m fuori scala/contesto |
| `vecchio-quartiere` | CC BY 4.0 | Pack di più edifici in una mesh, non separabile |
| `palo-elettrico` | CC BY 4.0 | Bounds 98 × 867 m: più pali e linee, non un palo |
| `passerella` | CC BY-SA 4.0 | Share-alike e nessun attraversamento dedicato |
| `strada-innevata` | CC BY-SA 4.0 | Share-alike e 577k triangoli senza LOD neve |

## Perché il resto non è forzato

- I tre terreni enormi e la striscia da 12 km non sono zolle: senza una
  reproiezione sul DEM e un LOD dedicato resterebbero sospesi o schiacciati.
  Il suolo giocabile è già coperto da `heightfield`, `landcover` e
  `world/field-detail.ts`.
- I VFX sono mesh, non particelle: `Precipitation` e `GroundMist` fanno già
  pioggia, neve e foschia con costo controllato.
- La chiesa di Venezia e la via di Viterbo sono luoghi reali di altri contesti;
  il mondo molisano usa chiese e strade procedurali.
- `passerella` e `strada-innevata` sono CC BY-SA: piazzarle obbligherebbe a
  trattare l'opera derivata con la stessa licenza, senza un bisogno di gioco.
- `palo-elettrico`, `vecchio-quartiere`, `svincolo-autostradale` e
  `infrastruttura-urbana` sono pack multi-oggetto o fuori scala: separarli
  richiederebbe un reimport, non un piazzamento.

## Verifica

```bash
npx tsc --noEmit
npm test
npm run build
npm run worldkit -- --check
```

- `tests/worldkit.test.ts` impone che ogni ruolo piazzato abbia almeno un
  modello, che i ritirati abbiano un motivo e che non restino `reserve`.
- `tests/quality.test.ts` impone che `roadside` e `bridges` crescano dal minimo
  all'ultra e valgano 0 su `minimal`.
- Banco prova: `node scripts/bench.mjs --quality medium --url http://127.0.0.1:5173`.
