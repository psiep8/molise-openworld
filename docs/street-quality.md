# Gruppo 5 — coerenza di meteo, camera, marciapiedi e arredo

Verifiche e correzioni di F16–F19. I numeri qui sotto sono misurati
sull'istanza di gioco in `?quality=high` (Palata, dati OSM del repository) e
leggendo i diagnostici da `window.moliseGame` / `window.__molise`.

## F16 — bagnato e pozze

Prima lo stato era uno solo: `roadWetness` con due costanti (`0,28` per
bagnare, `0,0018` per asciugare) e `standingWater` ricalcolato a ogni frame
dalla pellicola. Le pozze non potevano sopravvivere alla strada asciutta e
l'asciugatura era identica di notte e a mezzogiorno.

Ora `src/world/wetness.ts` tiene **due** stati con costanti separate:

| stato | bagnatura | asciugatura |
| --- | --- | --- |
| pellicola | 0,30 /s | 0,0028 + 0,0045·giorno + 0,0018·vento (1/s) |
| acqua ferma | 0,16 /s | 0,0009 /s |

Con il sole a mezzogiorno la pellicola scende sotto metà in ~1,5 minuti; di
notte senza vento serve una quindicina di minuti per asciugare quasi del tutto.
Le pozze restano più a lungo della
pellicola e continuano a contare nell'aderenza (`drivingWater`). Il passo è
limitato a 250 ms: un frame lungo (scheda in background, menu aperto) non
asciuga il mondo come dieci minuti veri.

L'intensità dell'ambiente (`scene.environment`, la cubemap PMREM del cielo)
viene alzata fino a +85% quando la strada è bagnata: con roughness 0,03 le
pozze devono specchiare il cielo, non restare spente come l'asfalto asciutto.

Test: `tests/wetness.test.ts` (8 casi: bagnatura rapida, asciugatura continua
e lenta, sole/vento, pozze che sopravvivono, clamp del passo, NaN).

## F17 — camera con braccio a molla

La vecchia camera interpolava la posizione e **poi** la correggeva dentro gli
edifici (`constrainCameraToBuildings`), con un salto verticale di 1,5 m quando
il muro era a ridosso dell'auto. Era quel secondo passaggio a far "strappare"
l'inquadratura.

Ora `src/gfx/camera-arm.ts`:

- `sweepArm` misura lo spazio libero lungo il raggio (passo 35 cm, margine
  45 cm);
- `sweepArmCone` controlla anche ±6°: in curva il muro entra di lato e il
  braccio si ritira **prima** che tagli la linea di vista, senza però arrivare
  alle facciate ai lati di una via stretta;
- `springArmLength` accorcia a 10 /s e riallunga a 2,2 /s (camminata 13 / 2,4),
  senza mai superare lo spazio libero né scendere sotto 0,55–0,8 m;
- near plane adattivo: 4,5 cm sotto 1,3 m di braccio, 10 cm sopra 1,9 m.

Misura in gioco con l'auto a 3,2 m da una casa, camera dietro:

| grandezza | valore |
| --- | --- |
| braccio ideale (target→camera) | 12,00 m |
| braccio libero misurato | 8,55 m |
| primo passo di accorciamento | 0,53 m |
| passi successivi | 0,45 · 0,38 · 0,32 · 0,27 · 0,23 m |
| riallungamento da 3 m a 1 s | 7,94 m (passo max 0,20 m) |
| camera finale dentro l'edificio | no |

Test: `tests/camera-arm.test.ts` (15 casi, inclusi sweep con muro, minimo,
direzione nulla, continuità e riallungamento lento).

## F18 — marciapiedi

Il passo era `0,98 × lunghezza del modulo precedente`. Con le varianti del
pack (1,15 m, 2 m, 8 m, 12 m) questo apriva buchi quando il modulo successivo
era più corto: fino a `0,49 × L` (≈ 0,6 m con le lastre da 1,15 m). Inoltre si
controllava solo il **centro** del modulo contro gli incroci, quindi una lastra
da 12 m poteva attraversare una via laterale.

Correzioni in `src/world/roadside-kit.ts`:

- cursore: l'inizio del modulo successivo è `fine precedente − 2% della
  lunghezza nuova`, qualunque variante arrivi;
- incroci: si campionano inizio, quarti, centro e fine sulla linea del
  marciapiede (`isOnRoad`, 35 cm), non solo il centro;
- pendenza: il modulo si inclina con il DEM ai due estremi (`pitch` +
  `pitchAxis`), con il segno giusto per i moduli lunghi su X e su Z;
- diagnosi in `diagnostics`: buchi > 5 cm, sovrapposizioni > 6%, quota fuori
  1 cm, campate saltate per incrocio o pendenza.

Misura in gioco (`__molise.world.roadside`):

| voce | valore |
| --- | --- |
| moduli marciapiede | 880 |
| moduli cordolo | 720 |
| buchi | 0 |
| sovrapposizioni | 0 |
| quote errate | 0 |

Test: `tests/roadside.test.ts` (continuità con varianti 2 m / 1,15 m,
inclinazione su 5%, incrocio a 100 m, budget).

## F19 — lampioni e cartelli

Regole corrette:

- **lampioni**: passo 28–35 m deterministico per strada, palo 40 cm oltre il
  bordo esterno del marciapiede (prima l'offset ignorava il cordolo e il palo
  finiva a 13 cm dal filo delle lastre), niente palo entro 80 cm dal ciglio di
  un'altra strada, pendenza ≤ 10°, dedupe a 6 m fra strade che si toccano;
- **cartelli OSM**: il nodo mappa è il punto in cui vale il segnale, non il
  palo. `placeSignBesideRoad` proietta sulla mezzeria e porta il palo a 85 cm
  oltre il ciglio; se lì c'è un muro prova l'altro lato, se anche quello è
  occupato il cartello non si mette. Due segnali sullo stesso angolo (entro
  70 cm) vengono deduplicati;
- **targhe di via**: prima 17 su 60 cadevano sull'asfalto di una via laterale e
  13 su pendenze oltre la soglia; ora si scarta il punto se `isOnRoad` e si
  cerca il successivo.

Misura in gioco:

| arredo | esaminati | in strada | in edificio | pendenza | fuori quota | sovrapposti |
| --- | --- | --- | --- | --- | --- | --- |
| lampioni | 507 | 0 | 0 | 0 | 0 | 0 |
| segnaletica (targhe) | 59 | 0 | 0 | 0 | 0 | 0 |

Prima della correzione, sulle stesse targhe: **17 in strada** e **13 su
pendenza**. Il dataset del repository non contiene cartelli OSM
(`osm.json` non ha `signs`), quindi il ramo `placeSignBesideRoad` è coperto dai
test sintetici ma non da un conteggio a runtime.

I diagnostici sono esposti in `__molise.world.furniture` (per tipo) e
`__molise.world.furniture.faults` (somma), oltre a `__molise.world.roadside`.

Test: `tests/furniture-audit.test.ts` (proiezione sul ciglio, lato opposto,
conteggio violazioni, distanza minima).

## Limiti

- fps e resa visiva non sono misurati: la VM di sviluppo non ha GPU e gira in
  software a ~0,5 fps; il braccio è verificato per numeri e unit test, non con
  un video a 60 fps.
- La suite completa (`npx vitest run`) passa 560/561 test; l'unico fallimento è
  `tests/car-models.test.ts`, che richiede i `.glb` delle auto non presenti in
  questo checkout (il test si attiva solo se almeno un modello c'è).
