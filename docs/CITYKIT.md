# City kit (threejsassets.com) — acquisizione e uso

Documento operativo per gli asset 3D esterni. Regola di fondo: **il mondo resta
quello vero di Palata** (OSM + DEM); il kit serve a rendere credibili strade,
marciapiedi, vegetazione, arredo urbano, veicoli e margini di campagna, non a
sostituire la geografia.

---

## 1. Cosa prendiamo e perché

Il catalogo del sito è stato censito per intero (2.288 asset, 937 nel tier free).
Quasi tutti sono **low-poly stilizzati** (City, Cozy Village, Metropolis, Vice
Beach…): dentro un paese molisano fotorealistico si notano subito e farebbero
peggio delle mesh procedurali. L'unico pack in **scala reale e PBR** è
**Realistic City**, e il suo tier free contiene i pezzi che oggi sono più deboli.

**38 asset in uso**, in cinque gruppi: 13 fotorealistici, 7 di scenario, 4 auto
low-poly, **8 edifici rurali** e **6 alberi da campo**.

### 1.1 Realistic City (13 free, 12,4 MB)

| Ruolo nel motore | Asset | Note |
| --- | --- | --- |
| `road-surface` | Realistic Road Straight 01 | asfalto 12 m, materiali per i nastri OSM |
| `road-junction` | Realistic Road Intersection 01 | usura e patch nelle zone di incrocio |
| `sidewalk` | Realistic Sidewalk 01 | 3 × 12 m, cordolo in granito, lastre con giunti |
| `plaza` | Realistic Plaza Paving 01 | pavimentazione della piazza di Palata |
| `tree-street` | Realistic Street Tree 01 | chioma volumetrica |
| `tree-park` | Realistic Park Tree 01 | alberi da parco e bosco |
| `lamp` | Realistic Street Lamp 01 | lampione stradale |
| `traffic-light` | Realistic Traffic Light 01 | semaforo |
| `sign` | Realistic Street Sign 01 | palo zincato per i nostri STOP/precedenza/50 |
| `bench` | Realistic Bench 01 | panchina |
| `bin` | Realistic Trash Bin 01 | cestino |
| `car` | Realistic Car Sedan 01 | auto parcheggiate e traffico |
| `boulder` | Realistic Rock Boulder 01 | masso fotorealistico, usato con parsimonia |

### 1.2 Scenery low-poly (7 free degli altri pack)

Servono a riempire i vuoti che il terreno da solo non racconta. Sono oggetti
piccoli, senza dettagli leggibili a 20 m: la sagoma è quella giusta e il costo è
0,4–2k triangoli l'una, quindi non abbassano la resa.

| Ruolo nel motore | Asset | Note |
| --- | --- | --- |
| `hedge` | Hedgerow Run | siepi lungo le strade di campagna |
| `bush` | Bush Round 01 | rovi e cespugli ai bordi delle siepi |
| `reed` | Cattail Reed Clump | canneti lungo i torrenti |
| `rock` | Mossy Boulder | massi muschiosi sui pendii |
| `rock` | Moraine Boulder | massi di morena |
| `rock` | Railway Rock Cluster | pietraie basse |
| `wreck` | Wrecked Car | relitto abbandonato fuori dal paese |

Più modelli sullo stesso ruolo sono **varianti**: il motore ne sceglie una per
istanza (`KitSpot.variant`), quindi tre tipi di masso restano una manciata di
draw call.

### 1.3 Auto low-poly (4 free degli altri pack)

Alternano le berline in sosta lontano dallo spawn e, dalla stessa carrozzeria,
sono anche guidabili (vedi §1.3.1). Il davanti è stato verificato
decodificando i GLB: i fari rossi stanno a **−Z**, quindi il muso è a **+Z**,
come la berlina del kit e come il codice di parcheggio già presume. Sono un solo
ruolo (`car-lowpoly`) con quattro varianti; la scala è ricalcolata sulla
lunghezza reale (4,3 m) perché i modelli sono più corti del vero.

| Ruolo | Asset | Triangoli |
| --- | --- | --- |
| `car-lowpoly` | Paris Car 01 | 38.575 |
| `car-lowpoly` | Family Sedan | 2.424 |
| `car-lowpoly` | Pastel Sedan | 7.144 |
| `car-lowpoly` | White Sports Convertible | 6.904 |

Vicino a casa (150 m) resta solo la berlina fotorealistica: è lì che la si
guarda da vicino. Oltre, il 45% delle auto in sosta è low-poly.

#### 1.3.1 Le stesse carrozzerie come veicoli guidabili

Quattro voci del catalogo (`src/sim/vehicle-catalog.ts`) usano questi GLB al
posto della mesh procedurale, tramite il campo `model` (lo slug del manifest):

| Veicolo | `id` | `model` | Lunghezza |
| --- | --- | --- | --- |
| Familiare low-poly | `kit-family-sedan` | `family-sedan` | 4,42 m |
| Parigina low-poly | `kit-paris-car` | `paris-car-01` | 4,12 m |
| Sedan pastello | `kit-pastel-sedan` | `pastel-sedan` | 4,50 m |
| Spider bianca | `kit-convertible` | `white-sports-convertible` | 4,24 m |

- **Rendering**: `Vehicle.resolveExternal` cerca l'asset con `CityKit.bySlug`,
  clona il template (materiali condivisi) e lo scala sulla lunghezza dello spec.
  Il muso dell'asset è a **+Z**, il gioco guida a **−Z**: la carrozzeria viene
  ruotata di 180° e riappoggiata a terra/centrata. I due `SpotLight` dei fari
  vengono aggiunti come per le auto procedurali.
- **Fisica**: quella di `src/sim/car.ts`, con ingombri, passo, carreggiata,
  massa e prestazioni dello spec. Le prestazioni delle quattro voci sono **dati
di riferimento di segmento**, non schede tecniche reali (il catalogo lo dice
  nel commento sopra le voci).
- **Ruote**: i quattro GLB sono **un solo oggetto**, quindi vengono separate a
  runtime (`src/entities/car-wheels.ts`): si isola la componente triangolare di
  ogni ruota, le quattro vanno agli angoli e il perno nasce al centro del mozzo.
  Il raggio è quello misurato sul modello, quindi il rotolamento combacia con
  l'asfalto. Se l'analisi fallisce (gomma attaccata al corpo, ruota a cubo), le
  ruote restano ferme e il resto funziona. Sotto ogni ruota c'è un'ombra di
  contatto. Le auto importate dal garage seguono la stessa strada, e hanno in
  più la correzione del muso da menu. Vedi `docs/GARAGE.md`.
- **Riflessi**: la cubemap del cielo (`scene.environment`) arriva anche qui con
  un boost per famiglia di materiale, così vernice e vetri non sembrano
  plastica.
- **Tinta**: il menu mostra un avviso e non applica la palette; il colore è
  quello del GLB (`Vehicle.paintable` è `false`).
- **Senza kit**: `resolveExternal` restituisce `null` e si costruisce la
  carrozzeria procedurale, come per qualsiasi altro veicolo. Nessun errore.
- La berlina fotorealistica `realistic-car-sedan-01` resta **solo in sosta**:
  è quella che si guarda da vicino e le ruote sono fuse nei materiali
  `rub`/`alloy`; da guidare sembrerebbe un modellino fermo.

### 1.4 Edifici rurali (8 free degli altri pack)

Sono case coloniche, rimesse e garage low-poly. **Non sostituiscono le case di
Palata**, che restano quelle vere di OSM: si usano **solo fuori dal paese**,
lungo le strade di campagna, dove una sagoma a 30 m conta più del dettaglio.
Sono 1,2–2,4k triangoli l'una, quindi una masseria costa meno di una panchina
fotorealistica.

| Ruolo | Asset | Triangoli | Note |
| --- | --- | --- | --- |
| `house` | Farmhouse | 1.506 | casale classico |
| `house` | Bungalow House | 1.860 | casa bassa con veranda |
| `house` | Two Story House | 2.403 | casa a due piani |
| `house` | Ranch House | 1.621 | pietra a un piano |
| `house` | Home Cottage 01 | 1.226 | cottage piccolo |
| `house` | Home Thatched House 01 | 1.378 | tetto di paglia |
| `shed` | Garden Shed | 1.136 | rimessa da attrezzi |
| `shed` | Garage | 1.479 | garage di campagna |

### 1.5 Alberi da campo (6 free degli altri pack)

Ulivi, frutteti e conifere da mettere attorno ai casali e lungo i bordi delle
strade rurali. `olive-tree` è il più caro (22k triangoli) ed è anche il più
caratteristico del Molise; l'acero autunnale (88k) compare **solo** sui preset
high/ultra e con peso basso.

| Ruolo | Asset | Triangoli | Note |
| --- | --- | --- | --- |
| `tree-country` | Olive Tree | 22.484 | ulivo |
| `tree-country` | Apple Tree | 568 | melo da frutto |
| `tree-country` | Birch Tree | 456 | betulla |
| `tree-country` | Lineside Pine | 452 | pino di bordo strada |
| `tree-country` | Arborvitae Conifer | 590 | conifera da giardino |
| `tree-country` | Autumn Maple | 88.062 | acero in autunno (solo high/ultra) |

**Dove finiscono** (`src/world/farmsteads.ts`): fuori dal paese (260–2300 m da
Palata), a 15–30 m dal ciglio delle strade rurali, con almeno 105 m tra due
casali e controlli su pendenza, acqua ed edifici. La posizione è deterministica
(`mulberry32`, seed fisso), quindi il paesaggio è lo stesso a ogni avvio.
Statistiche ad alta qualità: **18 case, 11 rimesse, 46 alberi**. I limiti
scendono con i preset (bassa: 5/3/10; media: 11/7/26; ultra: 24/16/64).

**Collisioni**: ogni casa e ogni rimessa registra la propria **impronta
ruotata** in `BuildingIndex` *prima* che vegetazione, erba e alberi vengano
costruiti. Così il giocatore non ci passa attraverso e nulla ci cresce dentro.
Non è un dettaglio cosmetico: senza l'impronta, l'erba alta sarebbe comparsa in
mezzo al salotto.

### 1.6 Cosa NON usiamo (e perché)

- **Case e negozi low-poly *dentro* Palata** (`general-store`,
  `deco-shopfront-row`…): le case del paese hanno l'impronta OSM vera.
  Sostituirle con mesh finite significa inventare un altro paese; accanto alle
  facciate procedurali si vedrebbe subito lo stile diverso. I modelli rurali
  sono ammessi solo fuori, dove non c'è un edificio OSM da confrontare.
- **Furgone** (`van-wav-ramp-01`) e **snowcat**: il primo ha proporzioni da
  mezzo con rampa, il secondo non esiste in Molise. Restano fuori.
- **Tile di terreno/strada da 4 × 4 m**: i nastri OSM hanno UV metriche e
  materiali PBR; una griglia a scacchiera si vedrebbe.
- **Interni, ferrovia, bayou, nuvole, sky dome**: non c'è il posto (Palata non ha
  ferrovia né bayou; il cielo è fisico, le nuvole sono procedurali).
- **`realistic-brownstone-01`, office tower, canal, subway, sky dome**: free ma
  incoerenti con il posto.
- **Altri alberi low-poly generici** fuori dai sei scelti: le chiome attuali
  sono card fotografiche con alpha e vento; un albero flat-shaded accanto alle
  card si nota. I sei `tree-country` funzionano perché stanno lontano, attorno
  ai casali.

I **112 GLB restanti** presenti in `public/citykit/` non entrano nel manifest e
non vengono caricati: restano su disco se un giorno servono, senza costare né
memoria video né draw call.

---

## 2. Licenza — regole da non violare

- Licenza: **Free Commercial License** di threejsassets.com
  (<https://threejsassets.com/license#free-asset-license>). Uso in prodotti,
  anche commerciali, **senza obbligo di attribuzione**; modifica e combinazione
  consentite.
- **Vietato ridistribuire i file**, anche modificati: niente mirror, asset pack,
  dataset, repo pubblici, download condivisi.
  Per questo `public/citykit/` è in `.gitignore` e i GLB **non** entrano nel
  repository, esattamente come le texture CC0 da 28 MB.
- La chiave API è personale: non va committata né condivisa. `.env.local` è già
  ignorato da git.
- Senza kit il gioco resta completo: strade, arredo e vegetazione hanno un
  fallback procedurale. Fanno eccezione la piazza e le targhe del kit: senza GLB
  non compaiono (le targhe delle vie sono procedurali e restano).

---

## 3. Creare la chiave e scaricare

1. Crea un account gratuito su <https://threejsassets.com>.
2. **Account → Connections → API key**: crea una chiave con scope
   `catalog:read` + `downloads:read`.
3. Scrivi la chiave in `.env.local` (file ignorato da git):

   ```
   THREEJSASSETS_KEY=tja_live_xxxxxxxxxxxxxxxx
   ```

4. Scarica:

   ```bash
   npm run kit -- --list   # cosa è free nel pack (nessuna chiave)
   npm run kit             # scarica i 38 asset + manifest + decodificatore Draco
   ```

   Non vuoi usare una chiave? Scarica a mano i file free dal sito (pulsante
   **Download** su ogni asset, il file si chiama `<slug>.glb`), mettili in
   `public/citykit/` e indicizzali:

   ```bash
   npm run kit -- --index
   ```

`--index` **non usa la rete**: legge i GLB che trova, tiene solo i **38 slug
della lista curata**, ricava triangoli/byte/sha256 dal file e riscrive manifest
e NOTICE. Segnala i file assenti e quanti GLB restano fuori dal manifest, ma non
fallisce per un file opzionale mancante. Lo script è idempotente: salta i file
già presenti e corretti, riscarica con `--force`, accetta `--only=slug,slug`. Una
richiesta alla volta, come chiede la documentazione delle API (budget più
stretto per i download).

### Lista per il download manuale (13 obbligatori)

Tutti nel tier **free** del pack Realistic City. Salvali in `public/citykit/`
con il nome `<slug>.glb` (è il nome con cui il sito li scarica), in una cartella
piatta.

| # | Ruolo | Asset | Slug / file | Byte |
| --- | --- | --- | --- | --- |
| 1 | strada | Realistic Road Straight 01 | [`realistic-road-straight-01`](https://threejsassets.com/assets/realistic-road-straight-01) | 1.050.660 |
| 2 | incrocio | Realistic Road Intersection 01 | [`realistic-road-intersection-01`](https://threejsassets.com/assets/realistic-road-intersection-01) | 1.166.864 |
| 3 | marciapiede | Realistic Sidewalk 01 | [`realistic-sidewalk-01`](https://threejsassets.com/assets/realistic-sidewalk-01) | 593.868 |
| 4 | piazza | Realistic Plaza Paving 01 | [`realistic-plaza-paving-01`](https://threejsassets.com/assets/realistic-plaza-paving-01) | 4.036.796 |
| 5 | albero strada | Realistic Street Tree 01 | [`realistic-street-tree-01`](https://threejsassets.com/assets/realistic-street-tree-01) | 1.078.972 |
| 6 | albero parco | Realistic Park Tree 01 | [`realistic-park-tree-01`](https://threejsassets.com/assets/realistic-park-tree-01) | 955.140 |
| 7 | lampione | Realistic Street Lamp 01 | [`realistic-street-lamp-01`](https://threejsassets.com/assets/realistic-street-lamp-01) | 174.040 |
| 8 | semaforo | Realistic Traffic Light 01 | [`realistic-traffic-light-01`](https://threejsassets.com/assets/realistic-traffic-light-01) | 178.648 |
| 9 | segnale | Realistic Street Sign 01 | [`realistic-street-sign-01`](https://threejsassets.com/assets/realistic-street-sign-01) | 531.588 |
| 10 | panchina | Realistic Bench 01 | [`realistic-bench-01`](https://threejsassets.com/assets/realistic-bench-01) | 881.444 |
| 11 | cestino | Realistic Trash Bin 01 | [`realistic-trash-bin-01`](https://threejsassets.com/assets/realistic-trash-bin-01) | 1.120.692 |
| 12 | auto | Realistic Car Sedan 01 | [`realistic-car-sedan-01`](https://threejsassets.com/assets/realistic-car-sedan-01) | 718.416 |
| 13 | masso | Realistic Rock Boulder 01 | [`realistic-rock-boulder-01`](https://threejsassets.com/assets/realistic-rock-boulder-01) | 509.252 |

### Scenery, auto e campagna (25 opzionali, ma senza loro metà dell'effetto svanisce)

| Ruolo | Asset | Slug / file |
| --- | --- | --- |
| siepe | Hedgerow Run | [`hedgerow-run`](https://threejsassets.com/assets/hedgerow-run) |
| rovo | Bush Round 01 | [`bush-round-01`](https://threejsassets.com/assets/bush-round-01) |
| canneto | Cattail Reed Clump | [`cattail-reed-clump`](https://threejsassets.com/assets/cattail-reed-clump) |
| masso | Mossy Boulder | [`mossy-boulder`](https://threejsassets.com/assets/mossy-boulder) |
| masso | Moraine Boulder | [`moraine-boulder`](https://threejsassets.com/assets/moraine-boulder) |
| pietraia | Railway Rock Cluster | [`railway-rock-cluster`](https://threejsassets.com/assets/railway-rock-cluster) |
| relitto | Wrecked Car | [`wrecked-car`](https://threejsassets.com/assets/wrecked-car) |
| auto | Paris Car 01 | [`paris-car-01`](https://threejsassets.com/assets/paris-car-01) |
| auto | Family Sedan | [`family-sedan`](https://threejsassets.com/assets/family-sedan) |
| auto | Pastel Sedan | [`pastel-sedan`](https://threejsassets.com/assets/pastel-sedan) |
| auto | White Sports Convertible | [`white-sports-convertible`](https://threejsassets.com/assets/white-sports-convertible) |
| casa | Farmhouse | [`farmhouse`](https://threejsassets.com/assets/farmhouse) |
| casa | Bungalow House | [`bungalow-house`](https://threejsassets.com/assets/bungalow-house) |
| casa | Two Story House | [`two-story-house`](https://threejsassets.com/assets/two-story-house) |
| casa | Ranch House | [`ranch-house`](https://threejsassets.com/assets/ranch-house) |
| casa | Home Cottage 01 | [`home-cottage-01`](https://threejsassets.com/assets/home-cottage-01) |
| casa | Home Thatched House 01 | [`home-thatched-house-01`](https://threejsassets.com/assets/home-thatched-house-01) |
| rimessa | Garden Shed | [`garden-shed`](https://threejsassets.com/assets/garden-shed) |
| rimessa | Garage | [`garage`](https://threejsassets.com/assets/garage) |
| albero | Olive Tree | [`olive-tree`](https://threejsassets.com/assets/olive-tree) |
| albero | Apple Tree | [`apple-tree`](https://threejsassets.com/assets/apple-tree) |
| albero | Birch Tree | [`birch-tree`](https://threejsassets.com/assets/birch-tree) |
| albero | Lineside Pine | [`lineside-pine`](https://threejsassets.com/assets/lineside-pine) |
| albero | Arborvitae Conifer | [`arborvitae-conifer`](https://threejsassets.com/assets/arborvitae-conifer) |
| albero | Autumn Maple | [`autumn-maple`](https://threejsassets.com/assets/autumn-maple) |

Output:

```
public/citykit/
  manifest.json        # ruolo, nome, categoria, triangoli, byte, sha256, licenza
  NOTICE.md            # provenienza + tabella asset
  *.glb                # 38 modelli indicizzati (e gli altri, ignorati)
public/draco/          # decodificatore Draco copiato da node_modules/three
```

Il manifest è il contratto col motore: il codice cerca i **ruoli**, non i nomi
dei file, e un ruolo può avere più varianti.

---

## 4. Come il motore li usa (integrazione)

Attenzione a un dettaglio che il sito non dichiara: i GLB hanno il **pivot al
centro del bounding box**, non a terra. `src/world/citykit.ts` li normalizza al
caricamento (base a y = 0, centro in x/z) e cuoce la trasformazione nella
geometria, così le istanze hanno solo posizione e rotazione. I modelli low-poly
sono anche più piccoli del vero: le scale sono decise a mano per ruolo.

- **Strade e marciapiedi** (`src/world/roads.ts`): le tile non si incollano alle
  curve OSM. Si prendono i materiali PBR (`asphalt_slab`, `footway_flags`,
  `granite_kerb`) e si applicano ai nastri drappeggiati: UV in metri, repeat
  0,55 × 0,5 (asfalto 12 m, lastre 3 × 12 m) e vertex color bianco per non
  scurire due volte. Marciapiede e cordolo sono due mesh/materiali separati.
  La bagnatura del meteo resta attiva (`userData.roadWet`) con uno shader
  dedicato al materiale del kit.
- **Panchine e cestini** (`src/world/street-furniture.ts`): le panchine del kit
  sostituiscono quelle a scatole, i cestini compaiono ogni tre panchine. Tetti
  per preset (6/12/24/32 panchine) perché ognuna è 21k triangoli.
- **Alberi di strada e auto in sosta** (`src/world/city-props.ts`): alberi ogni
  ~26 m sul marciapiede dentro il paese, auto ogni ~28 m sulla fascia di sosta,
  nel senso di marcia, solo su strade larghe; tetti 0/10/22/32 alberi e
  4/10/18/24 auto secondo il preset. Oltre 150 m da casa il 45% delle auto è
  low-poly (4 varianti, scala 4,3 m), sempre con il muso a +Z. Tutto
  deterministico e limitato a Palata.
- **Piazza** (`src/world/piazza.ts`): davanti alla facciata della chiesa, 16 × 12
  m (si restringe a 13 × 10 o 10 × 8 se c'è una strada o un pendio forte, e non
  si costruisce se non c'è spazio). È un piano drappeggiato sul DEM con UV
  metriche (una mattonata ogni 12 m) e il materiale `plaza/paving`; cordolo in
  `granite_kerb` sui lati aperti, due panchine ai lati. La sua impronta entra in
  `paved.ts`, così erba e alberi non ci crescono sopra, ma non nelle collisioni:
  si cammina sul sagrato.
- **Targhe con il nome della via** (`street-furniture.ts`): dai nomi OSM, una per
  strada costruita (max 2 omonime a 900 m di distanza), su palo a bordo
  marciapiede, targa bianca con bordo blu disegnata su canvas. Max 60, nessun
  asset esterno.
- **Siepi** (`city-props.ts`): solo su strade asfaltate strette (3,2–6,4 m) e
  fuori dal paese, perché i muretti a secco occupano già le sterrate. Tratti di
  25–65 m intervallati da varchi, a 2,6–3,8 m dal bordo, con un rovo ogni ~6
  segmenti verso il campo. Tetti 48/120/220/340.
- **Canneti**: lungo i 96 torrenti OSM, un ciuffo ogni ~7 m con probabilità
  0,42, a 1,8–4,4 m dall'asse. Tetti 24/70/130/190.
- **Pietre**: griglia di 46 m entro 2,4 km da casa, solo su pendii 9°–42°,
  fuori da strade ed edifici. Tre varianti low-poly più il masso fotorealistico
  (1 su 8, max 2/4/8/10). Tetti 24/64/120/170 pietre.
- **Relitto**: uno solo, su una strada di campagna tra 520 e 1700 m da casa,
  di traverso nel fosso. È l'unico modello low-poly "di strada": non ha un verso
  e quindi non si nota lo stile.
- **Segnali** (`buildSigns`): il palo zincato è la parte `ss_galv` del kit,
  alto 2,95 m; la faccia resta disegnata su canvas perché le forme italiane
  sono ottagono STOP, triangolo "dare precedenza" (punta in basso) e disco 50,
  non la piastra rettangolare dell'asset. Con il kit il cartello sta a 2,52 m,
  sul marciapiede rialzato; senza kit resta il palo procedurale da 2,1 m.
- **Casali di campagna** (`src/world/farmsteads.ts`): è il pezzo nuovo di questa
  sessione. Fuori dal paese, a 15–30 m dalle strade rurali, compaiono 18 case,
  11 rimesse e 46 alberi (preset alto). Ogni casa/rimessa aggiunge la sua
  impronta ruotata a `BuildingIndex` **prima** di vegetazione, erba e alberi,
  così il giocatore non ci passa attraverso e nulla ci cresce dentro. La
  disposizione è deterministica (seed fisso) e tiene conto di pendenza, acqua,
  strade ed edifici OSM. Dettagli e limiti per preset in §1.4.
- **Non piazzati di proposito**: semaforo, lampione, incrocio, alberi da parco.
  Sono scaricati e pronti, ma un semaforo in un paese senza semafori o un
  lampione urbano da 8 m al posto delle lanterne da 6,2 m romperebbe la
  coerenza. Il materiale della piazza invece si usa, per il sagrato. Le case e
  gli alberi rurali si usano **solo fuori** dal paese.

Tutto è additivo: se `public/citykit/manifest.json` manca (macchina nuova,
licenza non accettata, rete assente) il motore usa le mesh procedurali e non
cambia nulla. Diagnostica: `window.__molise.kit` =
`{ assets, trees, cars, hedges, bushes, reeds, rocks, wrecks, houses, sheds, countryTrees, piazzas }`
o `null`.

### Personalizzare macchine, alberi e cartelli

- **Auto**: la carrozzeria è la parte `car_sedan_01_paint`; il loader prepara una
  copia del materiale con colore bianco e ogni istanza riceve la sua tinta
  (`InstancedMesh.setColorAt`). La palette sta in `CAR_COLORS`
  (`src/world/city-props.ts`): dodici tinte da paese, niente colori da showroom.
  Cambiare l'array cambia tutte le auto parcheggiate.
- **Alberi**: scala 0,88–1,10 e rotazione casuale per istanza; il modello è uno
  solo, quindi la varietà è di taglia e orientamento.
- **Cartelli**: l'asset ha una faccia rettangolare già stampata. Per avere STOP,
  dare precedenza e limite 50 italiani si sostituisce la mappa della faccia con
  i canvas di `signTexture()` (già in `street-furniture.ts`, nessun asset).
  Operazione da fare quando si attiva il segnale del kit.
- **Siepi, rovi, canneti**: scala e rotazione casuali per istanza; le varianti
  extra si aggiungono con nuovi slug/ruoli in `SCENERY`
  (`scripts/fetch-citykit.mjs`) senza toccare il codice.
- **Casali e alberi rurali**: si aggiungono altri modelli con i ruoli `house`,
  `shed`, `tree-country` nelle liste `RURAL` / `COUNTRY_TREES` di
  `scripts/fetch-citykit.mjs`. I tetti per preset stanno in `HOUSE_LIMIT`,
  `SHED_LIMIT`, `TREE_LIMIT` (`src/world/farmsteads.ts`); i pesi delle varianti
  di albero stanno in `pickTreeVariant`.
- **Targhe, fari, vetri**: sono parti separate (`..._plateW`, `..._lensClear`,
  `..._glass`), quindi si possono scurire, spegnere o cambiare senza toccare la
  carrozzeria.

---

## 5. Stato

| Passo | Stato |
| --- | --- |
| Censimento catalogo (2.288 asset, 937 free) | ✅ fatto |
| Script di acquisizione + manifest + licenza | ✅ fatto, `--list`, `--index` e download verificati |
| Download dei 13 GLB Realistic City + manifest | ✅ fatto (13/13, indicizzati) |
| Loader runtime (Draco, pivot, varianti, istanze) | ✅ fatto, `tsc` pulito |
| Strade, marciapiedi, panchine, cestini, alberi, auto | ✅ integrati nel codice |
| Siepi, rovi, canneti, pietre, relitto | ✅ integrati nel codice |
| Piazza davanti alla chiesa | ✅ integrata nel codice |
| Targhe con i nomi delle vie | ✅ integrate nel codice |
| Segnali su palo del kit, facce italiane | ✅ integrato nel codice |
| Auto low-poly in sosta | ✅ integrate (davanti a +Z verificato sui GLB) |
| Auto low-poly guidabili (4) | ✅ integrate nel catalogo e nel rendering |
| Campagna: 8 case/rimesse + 6 alberi (14 GLB) | ✅ indicizzati e piazzati da `farmsteads.ts` |
| Impronte di collisione dei casali | ✅ prima di vegetazione ed erba |
| Garage Smooth Voxels / auto importate | ✅ integrato (`docs/GARAGE.md`) |
| Verifica visiva e fps | ✅ guardata in gioco (high): 18 case, 11 rimesse, 46 alberi; nessun errore console |

Le verifiche di questa sessione sono state fatte in gioco a preset **high**
(`?quality=high`): `npm run build` ✅, `npm test` 193/193 ✅, nessun errore in
console, conteggi dei casali corretti. Restano da guardare con calma, in una
cattura dedicata, la scala del relitto e dei massi, le siepi che non devono
entrare nelle case e la piazza che deve appoggiarsi ai gradini della chiesa.
Niente ✅ dove non c'è una prova: il codice compila e i test sono verdi, ma la
resa a schermo e il costo in fps vanno ricontrollati a ogni modifica.
