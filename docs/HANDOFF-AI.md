# Handoff per un'altra AI — City kit threejsassets

> Documento autosufficiente: contiene contesto, stato, comandi, vincoli di licenza
> e cosa resta da prendere da <https://threejsassets.com>. Ultimo aggiornamento:
> **23 ottobre 2026**, dopo il passaggio sul paesaggio di campagna.
> Progetto: `molise-openworld` (Palata, Molise) — TypeScript + Vite + Three.js.

---

## 0. TL;DR per chi riprende

1. Il gioco è una ricostruzione di **Palata (CB) e paesi vicini** da OSM + DEM.
   Il mondo resta geografico: **non** si sostituisce con un kit a griglia.
2. Sono in uso **24 asset free**: i **13 del pack Realistic City** (fotorealistico,
   scala reale) più **11 low-poly** degli altri pack per siepi, rovi, canneti,
   pietre, un relitto e quattro berline. Sono già integrati: asfalto,
   marciapiedi, panchine, cestini, alberi di strada, auto in sosta, margine di
   campagna, piazza davanti alla chiesa e targhe con i nomi delle vie.
3. I GLB **non sono nel repository** (licenza free: uso sì, ridistribuzione no).
   Vanno rigenerati o copiati in `public/citykit/` sulla macchina nuova.
   In `public/citykit/` ce ne sono **150**: 126 non sono nella lista curata e il
   motore non li carica.
4. Restano **5 asset free non presi** (fuori contesto) e **5 presi ma non
   piazzati** (semaforo, segnale, lampione, incrocio, alberi da parco).
   Il pack completo ha **137 asset premium** ($99): la lista prioritaria è al §6.
5. **Verifica visiva e fps non sono state eseguite.** Il codice compila
   (`tsc` pulito); test e build non sono stati rilanciati dopo l'ultimo
   passaggio. La resa a schermo è da guardare.

---

## 1. Contesto del progetto

- Open-world browser: si cammina e si guida tra **Palata, Montecilfone,
  Acquaviva Collecroce, Tavenna, Castelmauro** (~14 × 12 km).
- Dati locali in `public/geo/`: OSM compatto, DEM 10 m, mosaico Sentinel-2.
- Strade ed edifici sono generati dai dati veri: **non** si sostituiscono con
  tile da 4 m o 12 m, altrimenti Palata non si riconosce più.
- Stack: three 0.186, nessun framework UI, Vitest. Node ≥ 22.
- Comandi: `npm ci`, `npm run dev` (:5173), `npm run build`, `npm test`,
  `npm run preview` (:4173), `npm run smoke` (Chrome headless, richiede preview).
- Diagnostica runtime: `window.__molise` (ready, fps, errors, quality, …) e
  `window.__molise.kit = { assets, trees, cars, hedges, bushes, reeds, rocks,
  wrecks } | null`.

---

## 2. Cosa è stato preso da threejsassets

Pack: **Realistic City** (`https://threejsassets.com/packs/realistic-city`),
tier **free**. Al 23/10/2026 il pack ha **155 asset, 18 free**; ne abbiamo presi
**13** (12,4 MB). A questi si aggiungono **11 modelli low-poly** degli altri
pack free (circa 370 KB) per il margine di campagna e quattro berline.

| Ruolo nel motore | Slug | Triangoli | Uso |
| --- | --- | --- | --- |
| `road-surface` | `realistic-road-straight-01` | 3.362 | materiali asfalto sui nastri OSM |
| `road-junction` | `realistic-road-intersection-01` | 3.740 | preso, **non usato** |
| `sidewalk` | `realistic-sidewalk-01` | 1.612 | lastre + granito del cordolo |
| `plaza` | `realistic-plaza-paving-01` | 6.616 | preso, **non usato** |
| `tree-street` | `realistic-street-tree-01` | 23.962 | alberi sul marciapiede |
| `tree-park` | `realistic-park-tree-01` | 110.236 | preso, **non usato** (troppo pesante) |
| `lamp` | `realistic-street-lamp-01` | 20.654 | preso, **non usato** |
| `traffic-light` | `realistic-traffic-light-01` | 26.068 | preso, **non usato** |
| `sign` | `realistic-street-sign-01` | 28.120 | preso, **non usato** |
| `bench` | `realistic-bench-01` | 21.252 | panchine al posto delle scatole |
| `bin` | `realistic-trash-bin-01` | 22.522 | cestini ogni 3 panchine |
| `car` | `realistic-car-sedan-01` | 65.454 | berline in sosta |
| `boulder` | `realistic-rock-boulder-01` | 24.864 | pochi massi sui pendii |

### Scenery low-poly (7 free degli altri pack)

Oggetti piccoli e senza dettagli leggibili a 20 m; la sagoma è quella giusta e
costano 0,4–2k triangoli l'una.

| Ruolo | Slug | Triangoli | Uso |
| --- | --- | --- | --- |
| `hedge` | `hedgerow-run` | 1.912 | siepi lungo le strade di campagna |
| `bush` | `bush-round-01` | 360 | rovi ai bordi delle siepi |
| `reed` | `cattail-reed-clump` | 420 | canneti lungo i torrenti |
| `rock` | `mossy-boulder` | 388 | massi muschiosi |
| `rock` | `moraine-boulder` | 880 | massi di morena |
| `rock` | `railway-rock-cluster` | 620 | pietraie basse |
| `wreck` | `wrecked-car` | 11.930 | un relitto in un fosso |

I tre massi sono **varianti dello stesso ruolo** (`KitSpot.variant`); non sono
tre ruoli diversi. Nel manifest un ruolo può quindi comparire più volte.

### Auto low-poly (4 free degli altri pack)

Il davanti è a **+Z**: verificato decodificando i GLB (decoder Draco di three)
leggendo i colori, i fari rossi stanno a −Z. Quindi si parcheggiano con lo stesso
yaw della berlina del kit; scala ricalcolata sulla lunghezza di 4,3 m.

| Ruolo | Slug | Triangoli |
| --- | --- | --- |
| `car-lowpoly` | `paris-car-01` | 38.575 |
| `car-lowpoly` | `family-sedan` | 2.424 |
| `car-lowpoly` | `pastel-sedan` | 7.144 |
| `car-lowpoly` | `white-sports-convertible` | 6.904 |

**Perché questi e non il pack "City"** (quello linkato all'inizio): City è
low-poly moderno, griglia 4 m, palazzi vetrati al 70% dell'altezza reale. In un
paese molisano fotorealistico si nota subito. Realistic City è l'unico pack
**PBR in scala reale** del sito.

### Cosa NON è stato preso (e perché)

Altri **5 asset free** dello stesso pack:

| Slug | Perché no |
| --- | --- |
| `realistic-brownstone-01` | palazzina americana in mattoni: non esiste a Palata |
| `realistic-office-tower-01` | grattacielo da centro direzionale |
| `realistic-canal-tile-01` | canale navigabile con sponde in muratura |
| `realistic-subway-entrance-01` | metropolitana |
| `realistic-sky-day-dome-02` | il cielo attuale è fisico (Sky + sole NOAA) |

Sono tutti **free** e scaricabili: se servono per un'altra scena, vanno aggiunti
a `WANTED` in `scripts/fetch-citykit.mjs`.

### Il resto del sito

Censimento del catalogo pubblico: **2.288 asset, 937 free**. Oltre a Realistic
City sono **tutti low-poly stilizzati** (City 23 free, Cozy Village 17,
Suburban Neighborhood 44, Metropolis 19, Vice Beach 38, Railway 105, ecc.).
Ne usiamo solo 7, e solo per oggetti dove lo stile non si legge (siepe, canneto,
rovo, masso, relitto). **Case, negozi, auto e alberi low-poly restano fuori**:
le case di Palata devono restare le impronte OSM, le auto non hanno parti
separate e il davanti non è verificabile, le chiome attuali sono card
fotografiche con vento. Dettaglio e motivazioni in `docs/CITYKIT.md` §1.3.

In `public/citykit/` il proprietario ha messo **150 GLB**: i 126 che non sono
nella lista curata restano su disco ma non entrano nel manifest, quindi non
consumano memoria video né draw call.

---

## 3. Come rigenerare i file su un'altra macchina

I GLB sono in `public/citykit/` ed **esclusi da git** (`.gitignore`), insieme a
`public/draco/`. Senza di loro il gioco parte e usa le mesh procedurali.

### Opzione A — API key (consigliata)

1. Account gratuito su <https://threejsassets.com>.
2. **Account → Connections → API key**, scope `catalog:read` + `downloads:read`.
3. In `.env.local` (già ignorato da git):
   ```
   THREEJSASSETS_KEY=tja_live_xxxxxxxx
   ```
4. ```
   npm run kit -- --list   # free attuali del pack (nessuna chiave)
   npm run kit             # scarica i 24 + manifest + Draco
   ```

### Opzione B — download manuale

Scaricare i 13 file dal sito (pulsante Download; si chiamano `<slug>.glb`),
metterli in `public/citykit/` e lanciare:

```
npm run kit -- --index
```

**Non usa la rete**: legge i GLB presenti, tiene solo i 20 slug della lista
curata, ricava triangoli/byte/sha256 dal file, scrive `manifest.json`,
`NOTICE.md` e copia il decodificatore Draco da `node_modules/three` in
`public/draco/`. Segnala i file assenti e quanti GLB restano fuori, senza
fallire per un file opzionale mancante.

### Opzione C — copia privata (senza riscaricare)

Se i file sono già su una macchina, si possono copiare `public/citykit/` e
`public/draco/` con USB o cloud privato. **Non committarli e non pubblicarli**:
sono file dell'asset pack, non opere del progetto. La cartella `public/citykit/`
è già in `.gitignore`.

### Verifica rapida

```
ls public/draco                     # draco_decoder.js/.wasm, draco_wasm_wrapper.js
node -e "console.log(require('./public/citykit/manifest.json').assets.length)"  # 24
npm run kit -- --index             # riscrive il manifest dai file presenti
```

Poi `npm run dev` e in console: `window.__molise.kit` deve valere
`{ assets: 24, trees: >0, cars: >0, hedges: >0, rocks: >0, piazzas: 1 }`;
`window.__molise.errors` vuoto.

---

## 4. Come è integrato (file e scelte tecniche)

| File | Cosa fa |
| --- | --- |
| `src/world/citykit.ts` | loader GLB+Draco, normalizzazione pivot, parti, istanze, materiali |
| `src/world/city-props.ts` | alberi, auto (foto + low-poly), siepi/rovi/canneti/pietre/relitto |
| `src/world/roads.ts` | materiali kit su asfalto, lastre, cordolo; split marciapiede/cordolo |
| `src/world/street-furniture.ts` | panchine e cestini kit; targhe con i nomi delle vie |
| `src/world/piazza.ts` | sagrato drappeggiato davanti alla chiesa, cordolo e panchine |
| `src/world/paved.ts` | superfici lastricate condivise con erba e vegetazione |
| `src/game.ts` | carica il kit in parallelo alla mappa, lo passa ai builder, diagnostica |
| `scripts/fetch-citykit.mjs` | download/indicizzazione + manifest + licenza |
| `docs/CITYKIT.md` | documento operativo del kit |

Dettagli che fanno perdere tempo se non si sanno:

- **Pivot al centro del bounding box**, non a terra. `citykit.ts` lo sposta
  (base a y = 0, centro x/z) e **cuoce** la matrice nella geometria: le istanze
  hanno solo posizione/rotazione.
- **Orientamento**: +Z è il "davanti" per auto (fari bianchi a +Z, rossi a −Z),
  panchina (schienale a −Z), lampione (braccio a +Z), semaforo (frecce a +Z),
  segnale (faccia a +Z).
- **Misure reali**: tile strada 12 × 12 m; marciapiede 3 × 12 m (cordolo 0,3 m);
  panchina 1,79 m; auto 4,83 × 2,07 × 1,37 m; albero di strada 7,57 m; albero da
  parco 13,98 m; lampione 8,11 m; segnale 3,08 m; cestino 1,13 m.
- **Nomi delle parti/materiali** utili: `asphalt_slab`, `footway_flags`,
  `granite_kerb`, `car_sedan_01_paint`, `car_sedan_01_glass`,
  `car_sedan_01_lensClear`, `car_sedan_01_lensRed`, `tree_foliage_*`,
  `foliage_cards`.
- **UV**: asfalto `repeat` 0,55 × 0,5 (12 m), lastre 0,55 × 0,5 (3 × 12 m).
  I nastri hanno UV metriche: `u` attraversa, `v = metri / 6`.
- **Vertex color**: con i materiali del kit va tenuto bianco, altrimenti la
  texture viene scurita due volte.
- **Bagnatura meteo**: `CityKit.material(..., { wet: true })` aggiunge
  `userData.roadWet` e uno shader che legge quel valore (`game.ts` lo aggiorna).
- **Ruoli con varianti**: `CityKit.variants(role)`; `instances()` raggruppa le
  istanze per variante. I ruoli nuovi sono `hedge`, `bush`, `reed`, `rock`,
  `wreck`, `car-lowpoly`.
- **Piazza**: `buildChurchPiazza` sta in `piazza.ts`, usa `plaza/paving` e
  `sidewalk/granite_kerb`, e torna un `PavedArea` che `game.ts` passa a
  `buildVegetation` e a `new GrassField(...)`; senza area l'erba ci cresce sopra.
  Non è nelle collisioni: si cammina sul sagrato.
- **Tetti per preset**: panchine 6/12/24/32 (`street-furniture.ts`), alberi
  0/10/22/32 e auto 4/10/18/24, siepi 48/120/220/340, rovi 30/80/150/220,
  canneti 24/70/130/190, pietre 24/64/120/170 (`city-props.ts`). Sono modelli da
  21k–65k triangoli: non vanno piazzati come i procedurali.
- **Ombre**: siepi, rovi e canneti non le proiettano (centinaia di migliaia di
  triangoli, ombra invisibile); pietre e relitto sì.
- **Costo attuale stimato**: ~0,55 Mtri (low) → ~3,9 Mtri (ultra) di arredo kit,
  comprese le siepi. Da misurare in gioco.
- **Collisioni**: le auto in sosta **non** sono solide (l'indice collisioni è
  solo edifici). Se si vuole, aggiungere impronte a `BuildingIndex`.

---

## 5. Cosa manca ancora da fare (codice)

1. **Verifica visiva e fps** con `npm run dev` / `capture.mjs`, preset medium e
   high. Controllare: auto a filo asfalto (y = DEM + `roadLift`), alberi dentro
   il marciapiede, nessun buco tra asfalto e cordolo, materiali non slittati.
2. **Segnale**: sostituire la faccia rettangolare con i canvas di
   `signTexture()` (STOP, precedenza, 50) e usare il palo del kit; altrimenti
   restano i segnali procedurali (già corretti).
3. **Semaforo**: solo se si trova un incrocio vero che lo giustifica; altrimenti
   non piazzarlo.
4. **Lampione kit** (8,11 m): se si sostituisce quello procedurale (6,2 m) va
   rifatto il calcolo del pool di `PointLight` in `StreetLights`.
5. **Alberi da parco**: 110k triangoli l'uno; solo pochi e con LOD, oppure
   lasciarli fuori.
6. **LOD** per alberi e auto se gli fps calano: mesh piena vicino, billboard o
   scatola oltre ~120 m.
7. **Incrocio**: il materiale di `road-junction` può servire per le zone di
   giunzione, ma oggi i nastri si sovrappongono con `roadLift`.
8. **Veicolo del giocatore**: resta procedurale (22 modelli in
   `src/sim/vehicle-catalog.ts`). Il kit fornisce una sola berlina: usarla solo
   per la sosta, non per sostituire il catalogo.
9. **Nuovi prop da tarare in gioco** (nessuna verifica visiva fatta): scala del
   relitto (1,45–1,57) e dei massi (0,8–1,7), siepi che non entrino nei muri,
   canneti alla quota giusta rispetto all'acqua, piazza che si appoggia ai
   gradini della chiesa, targhe leggibili e non dentro i muri. I parametri sono
   in cima a `city-props.ts` (tetti e raggi), in `piazza.ts` (dimensioni) e in
   `buildStreetNames`.

---

## 6. Cosa manca da prendere ancora da threejsassets

### 6.1 Free: 5 asset (non consigliati per Palata)

Gli unici free del pack non ancora scaricati sono brownstone, office tower,
canal tile, subway entrance e sky dome (§2). Se il progetto resta Palata,
**non serviranno**. Se si vuole una scena urbana separata, si possono prendere
senza costi.

### 6.2 Premium: il pacchetto completo ($99, 137 asset)

Se il proprietario compra **Realistic City** ($99, licenza Pack Commercial: uso
nei prodotti, vietata la ridistribuzione dei file), questi sono i più utili, in
ordine di impatto:

**Edifici (il salto più grande)**
`realistic-tenement-01`, `realistic-row-shops-01`, `realistic-corner-store-01`,
`realistic-small-office-01`, `realistic-apartment-block-01`,
`realistic-cafe-terrace-01`, `realistic-shop-awning-01`,
`realistic-church-01`, `realistic-civic-hall-01`, `realistic-school-01`,
`realistic-library-01`, `realistic-theatre-01`, `realistic-hospital-wing-01`.

Attenzione: sono **mesh finite**, non modulari su impronta OSM. Vanno usate come
edifici di arredo in lotti vuoti/PAI, non per sostituire le estrusioni OSM.

**Arredo urbano**
`realistic-fire-hydrant-01`, `realistic-bollard-cones-01`,
`realistic-dumpster-01`, `realistic-bike-rack-01`, `realistic-bus-shelter-01`,
`realistic-iron-railing-01`, `realistic-manhole-cover-01`,
`realistic-power-pole-01`, `realistic-power-line-span-01`,
`realistic-drainpipe-01`, `realistic-storm-drain-01`,
`realistic-street-lamp-01` (free), `realistic-traffic-light-01` (free),
`realistic-street-sign-01` (free).

**Strade e marciapiedi**
`realistic-road-corner-01`, `realistic-road-t-01`,
`realistic-roundabout-01`, `realistic-road-crosswalk-01`,
`realistic-cobble-tile-01`, `realistic-sidewalk-corner-01`,
`realistic-sidewalk-straight-01`, `realistic-sidewalk-crossing-ramp-01`,
`realistic-speed-bump-01`.

**Veicoli**
`realistic-delivery-van-01`, `realistic-city-bus-01`,
`realistic-police-car-01`, `realistic-ambulance-01`,
`realistic-sports-car-01`, `realistic-taxi-01`, `realistic-bicycle-01`.

**Natura e dettaglio**
`realistic-hedge-row-01`, `realistic-shrub-01`,
`realistic-flower-planter-01`, `realistic-park-fountain-01`,
`realistic-rooftop-units-01`, `realistic-grass-verge-01`,
`realistic-park-lawn-01`, `realistic-surface-parking-01`.

**Insegne e segnaletica**
`realistic-awning-sign-01`, `realistic-billboard-01`,
`realistic-road-gantry-01`, `realistic-roof-billboard-01`.

Da **evitare** comunque: grattacieli, metropolitana, tram, canali, svincoli
autostradali, neon. Non esistono in un paese molisano.

### 6.3 Alternative fuori dal sito

Se il budget non c'è, per gli edifici conviene investire sulle facciate
procedurali (cornici, gronde, profondità reale delle finestre) invece di
comprare il pack: le mesh finite non si adattano alle impronte OSM.

---

## 7. Licenza e regole da non violare

- Tier free: **Free Commercial License** — uso in prodotti anche commerciali,
  nessuna attribuzione richiesta, modifica consentita.
- **Vietato** vendere, condividere, mirrorare, ridistribuire i file (anche
  modificati) come asset pack, dataset, template o repo pubblici.
  Per questo `public/citykit/` e `public/draco/` sono in `.gitignore`.
- Chiave API e `.env.local` non vanno committati né condivisi.
- Il pack premium, se comprato, ha la stessa restrizione sulla ridistribuzione.
- Il progetto non contiene asset Rockstar/GTA.

---

## 8. Stato verifiche (onesto)

| Verifica | Esito |
| --- | --- |
| `npx tsc --noEmit` | ✅ pulito dopo l'ultimo passaggio |
| `npm test` (171 test, 18 file) | ✅ verde **prima** del passaggio sul paesaggio |
| `npm run build` | ✅ verde **prima** del passaggio sul paesaggio |
| `npm run kit -- --list` / `--index` / chiave errata | ✅ verificati; `--index` è offline e ha indicizzato 24/24 |
| Browser, screenshot, smoke, fps | ❌ **non eseguiti** (richiesta esplicita del proprietario) |

Dopo l'ultimo passaggio (ruoli con varianti, siepi, canneti, pietre, relitto,
piazza, targhe, auto low-poly) è stato eseguito **solo `tsc`**, come chiesto:
«nessun test, nessun run dev». Le nuove posizioni non sono mai state viste a
schermo.

---

## 9. Primo giro consigliato sulla macchina nuova

```bash
git pull
npm ci
npm run kit -- --list        # se i GLB non ci sono, vedi §3
npm run dev                  # http://127.0.0.1:5173/?autostart=walk&quality=medium
```

In console:

```js
window.__molise.kit      // { assets: 24, trees, cars, hedges, bushes, reeds, rocks, wrecks, piazzas }
window.__molise.errors   // deve essere []
```

Poi guardare, in ordine: asfalto e cordolo a distanza ravvicinata, auto in sosta
(ruote a terra, dentro l'asfalto, muso nel verso di marcia), alberi sul
marciapiede, panchine e cestini allineati, piazza davanti alla chiesa appoggiata
ai gradini, targhe delle vie leggibili, siepi fuori dal paese, canneti lungo i
torrenti, massi sui pendii, relitto nel fosso, fps con `G` su high/ultra. Se
qualcosa è fuori posto, i parametri da toccare sono in `city-props.ts`
(distanze, offset, tetti), `piazza.ts` (dimensioni) e `street-furniture.ts`
(tetto panchine, targhe).

Buon lavoro. La regola del progetto resta una: **il posto deve sembrare vero**.
