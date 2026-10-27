# Garage: auto di serie su GLB e auto importate

Il gioco ha **due librerie di auto separate**, che non vanno confuse:

| | Auto di serie (`public/cars/`) | Auto importate (IndexedDB) |
| --- | --- | --- |
| Chi le mette | gli sviluppatori, come asset del gioco | il giocatore, dal menu o drag & drop |
| Dove vivono | file `.glb` + `manifest.json` versionato | IndexedDB del browser, max 12 |
| Come si scelgono | select **Veicolo**, senza prefisso | select **Veicolo**, prefisso `★` |
| Si possono eliminare | no | sì, con **Elimina importate** |
| Fisica | scheda tecnica reale in `vehicle-catalog.ts` | scheda stimata dagli ingombri |
| Licenza | crediti e licenze in `ATTRIBUTION.md` | dell'utente |

Le auto di serie si caricano una volta e vengono **normalizzate** (unità di
lunghezza, muso a +Z, base a `y = 0`, centrate in x/z); la scala finale viene
dalla lunghezza dello spec. La selezione è asincrona e usa un **generation
counter**: cambiando auto in fretta dal menu non si rischia di applicare un GLB
vecchio sopra quello nuovo. Se il file manca (repo clonato senza asset), il
gioco ricade sulla sagoma procedurale dello stesso spec senza errori.

### Modelli di serie

| Nome | Slug / `model` | File | `yaw` | Lunghezza |
| --- | --- | --- | --- | --- |
| 2010 Audi R8 5.2 FSI Quattro | `audi-r8-2010` | `2010_audi_r8_5.2_fsi_quattro.glb` | 0 | 4.43 m |
| 2011 Fiat Punto | `fiat-punto-2011` | `2011_fiat_punto.glb` | 0 | 4.07 m |
| 2021 BMW M4 Competition | `bmw-m4-competition-2021` | `2021_bmw_m4_competition.glb` | 0 | 6.6 m |
| 2025 Yamaha MT-09 SP V4 | `yamaha-mt09-sp-2025` | `22564002dee.glb` | 180 | 2.09 m |
| Aston Martin DB11 | `aston-martin-db11` | `aston_martin_db11.glb` | 90 | 5 m |
| Audi Novulari | `audi-novulari` | `audi_novulari.glb` | -90 | 6.19 m |
| Audi R8 Coupe Performance quattro 2023 | `audi-r8-2023` | `audi_r8_coupe_performance_quattro_2023.glb` | 0 | 4.43 m |
| BMW inspired 1930s Saloon car | `bmw-1930s-saloon` | `bmw_inspired_1930s_saloon_car.glb` | 0 | 4.5 m |
| BMW M3 Sedan topaz blue car | `bmw-m3-sedan` | `bmw_m3_sedan_topaz_blue_car.glb` | 0 | 4.77 m |
| Cupra_Terramar_Hero_Purple_GLB | `cupra-terramar` | `Cupra_Terramar_Hero_Purple_GLB.glb` | 90 | 4.52 m |
| DeTomaso P900 | `detomaso-p900` | `detomaso_p900.glb` | 0 | 4.9 m |
| Ferrari F1 2019 | `ferrari-f1-2019` | `ferrari_f1_2019.glb` | 0 | 5.7 m |
| Ferrari Laferrari \| www.vecarz.com | `ferrari-laferrari` | `ferrari_laferrari__www.vecarz.com.glb` | 0 | 4.7 m |
| Fiat 500 | `fiat-500` | `fiat_500.glb` | 0 | 3.55 m |
| Fiat 500 - 1970 Model | `fiat-500-1970` | `fiat_500_-_1970_model.glb` | 0 | 2.97 m |
| Fiat 500 Abarth | `fiat-500-abarth` | `fiat_500_abarth.glb` | 180 | 3.66 m |
| Fiat Multipla 1998 3D Model | `fiat-multipla-1998` | `fiat_multipla_1998_3d_model.glb` | 0 | 3.99 m |
| FIAT Panda 4x4 | `fiat-panda-4x4` | `fiat_panda_4x4.glb` | 0 | 3.65 m |
| Fiat Uno 1994 | `fiat-uno-1994` | `fiat_uno_1994.glb` | 0 | 3.69 m |
| (FREE) 1995 Fiat Punto GT | `fiat-punto-gt-1995` | `free_1995_fiat_punto_gt.glb` | 0 | 4.58 m |
| Honda Civic RS | `honda-civic-rs` | `honda_civic_rs.glb` | -90 | 4.57 m |
| LAMBORGINI REVOLTO | `lamborghini-revuelto` | `lamborgini_revolto.glb` | 0 | 5.95 m |
| Land Rover Defender | `land-rover-defender` | `land_rover_defender.glb` | 0 | 5.02 m |
| 2025 MG Cyberster (GLB)(mgmotor.com.mx) | `mg-cyberster-2025` | `m_cyberster.glb` | 0 | 2.41 m |
| Mistery Porsche | `porsche-911-mistery` | `mistery_porsche.glb` | 0 | 4.52 m |
| Seat Leon Cupra Race Car | `seat-leon-cupra-race` | `seat_leon_cupra_race_car.glb` | 0 | 4.2 m |
| Tesla-Cybertruck | `tesla-cybertruck` | `tesla-cybertruck.glb` | 0 | 5.68 m |
| Vespa Scooter | `vespa-scooter` | `vespa_scooter.glb` | 180 | 1.77 m |
| Volkswagen Crafter | `volkswagen-crafter` | `volkswagen_crafter.glb` | 0 | 5.99 m |
| Volkswagen Golf GTI (2025) | `volkswagen-golf-gti-2025` | `volkswagen_golf_gti_2025.glb` | 180 | 4.29 m |

La lunghezza della tabella è quella **misurata dal manifest** (diagnostica): la
scala finale usa `spec.length` in `src/sim/vehicle-catalog.ts`, che è la misura
reale della versione. `†` = modello fuori dalla lista di 25 crediti.

`yaw` è la rotazione attorno a Y (gradi) che porta il muso del modello verso
asdw**+Z**: il manifest è l'unico posto da toccare se un modello guarda dalla parte
sbagliata.

I GLB da showroom avevano **vetri bianchi/opachi** e un'emissive finta: il
loader riconosce i materiali del vetro per nome, li rende scuri e trasparenti e
azzera l'emissive. La cubemap del cielo arriva anche a questi materiali, quindi
la vernice riflette davvero.

Le **ruote** vengono cercate in quest'ordine: nomi dichiarati (`wheel-fl`…) →
nodo hub più in alto → clustering geometrico agli angoli → separazione
automatica (`splitCarWheels`). Il raggio è misurato sul modello, così il
rotolamento combacia col terreno. Dettagli in `src/world/car-library.ts` e
`src/entities/car-wheels.ts`.

I file `.glb` sono in `.gitignore`, il manifest è versionato. Crediti e licenze
sono in `ATTRIBUTION.md`: i modelli `SKETCHFAB Standard` non sono ridistribuibili.

### Ripristinare i GLB su un altro PC

I file delle auto di serie **non sono nel repository** e non si possono
rigenerare da zero: se mancano, il gioco usa le sagome procedurali. Per sapere
cosa manca:

```bash
npm run cars
```

Se i GLB esistono ancora su un altro PC (o su un disco esterno/backup), copiali
da lì con un solo comando. Lo script cerca ricorsivamente i `.glb`, riconosce i
nomi originali diversi e li rinomina secondo il manifest:

```bash
npm run cars -- --from "D:\\vecchio-pc\\modelli"
npm run cars -- --from "D:\\vecchio-pc\\modelli" --dry-run   # prova a vuoto
npm run cars -- --from "D:\\vecchio-pc\\modelli" --force     # sovrascrive
```

Lo script legge il manifest e riconosce i nomi originali dei 30 file; non
sovrascrive mai un file presente senza `--force` e verifica l'intestazione
GLB prima e dopo la copia. Se un file resta mancante lo script esce con
codice 1 (usare `--allow-missing` per evitarlo).

Le auto **importate dal giocatore** non sono in `public/cars/`: vivono in
IndexedDB, nel profilo del browser. Per portarle su un altro PC si esporta di
nuovo il GLB dall'editor e si reimporta dal menu (vedi §3.1).

### Vernice, tinta e fari notturni

La vernice dei modelli di serie non è più intoccabile. `src/gfx/car-paint.ts`
cerca il materiale della **scocca** e lo porta a `MeshPhysicalMaterial` con
clearcoat 1,0, `clearcoatRoughness` 0,06 e rugosità 0,32; poi lo tinge con la
palette del menu (o con la tinta scelta dal giocatore, salvata per veicolo).

Perché sia tingibile servono due cose, entrambe già vere in molti dei modelli:

| Requisito | Perché |
| --- | --- |
| un materiale **solo scocca**, con un nome riconoscibile (`carpaint`, `Body_Color`, `Body Paint`, `M_CarPaint_*`, `punto-body`…) | tingere un atlante unico colorerebbe anche vetri e cerchi |
| il colore **non cotto nella texture**, oppure una texture neutra | `material.color` moltiplica la mappa: una tinta rossa su una mappa blu dà nero |

Quando il colore è nella texture (Audi R8 blu, Defender grigio-verde) la tinta
viene applicata nello shader come `tinta × luminanza`, quindi il dettaglio
resta. L'Aventador ha un atlante unico `_BodySG` (scocca + cerchi): per lui la
**tinta è disattivata** e si può solo desaturare.

La **saturazione** è un'uniform sola per tutte le vernici (35–100%, predefinita
82%): *Impostazioni → Saturazione vernice*. Agisce sull'albedo dopo la texture,
quindi non spegne i riflessi del cielo.

**Fari**: `buildExternal` raccoglie i materiali con `lens`/`light`/`fanal` nel
nome (esclusi i trasparenti) e `setLights` ne pilota l'emissivo — spento di
giorno, 1,9 di notte. Se il GLB dichiara già un emissivo, il colore dell'autore
resta. Per un'auto nuova basta chiamare la lente `lensRoad` o `headlight`.

**Le auto importate dal giocatore restano com'erano**: materiali del suo file,
nessuna tinta e nessun fuso orario sulle luci (il modello è suo). Per questo in
`buildExternal` il ritocco si applica solo a `source !== customModel`.


Il resto di questo documento riguarda le **auto importate** dall'utente.

---

## 1. In tre passi

1. Apri <https://www.smoothdev.nl/smoothvoxels/>, crea il modello e scegli
   **Export → GLB**. Un `.glb` contiene già geometria, materiali e texture.
2. Nel gioco apri il menu (**Esc** o l'ingranaggio) → **Auto personalizzate** →
   **Importa GLB**, oppure trascina il file sulla finestra.
3. L'auto viene aggiunta alla select **Veicolo** con il prefisso `★`, diventa
   guidabile e resta salvata nel browser.

La select dei veicoli contiene i modelli di serie e, in fondo, le auto importate.
Il pulsante **Elimina importate** svuota il garage del browser; i GLB sul disco
non vengono toccati.

---

## 2. Convenzioni di modellazione

Sono le stesse del city kit, così un'auto può passare dal parcheggio alla guida
senza sorprese.

| Cosa | Regola | Perché |
| --- | --- | --- |
| Unità | **1 unità = 1 metro** | la scala dell'auto viene ricalcolata sulla lunghezza dello spec |
| Assi | lunghezza su **Z**, larghezza su **X**, altezza su **Y** | il rig e la fisica usano Z come asse di marcia |
| Muso | verso **+Z** | la carrozzeria viene ruotata di 180° perché il gioco guida con il muso a −Z |
| Base | ruote appoggiate a **y = 0** | il modello viene appoggiato al piano stradale, non al centro del bounding box |
| Centro | modello centrato su **x = 0, z = 0** | il veicolo ruota attorno al proprio centro |
| Materiali | PBR standard (`MeshStandardMaterial`/`MeshPhysicalMaterial`) | il renderer usa le mappe del GLB così come sono |
| Texture | incorporate nel GLB | il `.gltf` con `.bin`/texture esterne non è supportato dall'import |
| Peso | sotto ~80k triangoli è comodo | è un'auto vista da vicino, non un edificio |

Se il modello è più lungo che largo sull'asse X, l'importer lo ruota di 90° per
portare la lunghezza su Z. Il verso del muso però non è deducibile: **va messo a
+Z in modellazione**, altrimenti l'auto guida all'indietro.

### 2.1 Ruote animate

Un GLB esportato come **un solo oggetto** ha le ruote fuse nella carrozzeria.
Il gioco prova a separarle da solo (`src/entities/car-wheels.ts`): collega i
triangoli che condividono gli stessi vertici, cerca le componenti che hanno
forma di ruota (due assi larghi e uno stretto, nella parte bassa del veicolo),
prende le quattro più vicine agli angoli e ci mette un perno al centro del
mozzo. Se ci riesce le ruote girano e sterzano, e il **raggio viene misurato
sul modello**, quindi il rotolamento combacia con la strada (una ruota più
grande dello spec girerebbe più lento e sembrerebbe che strisci).

Se le ruote sono invece **oggetti separati**, si comportano ugualmente, a
patto che siano chiamati esattamente:

```
wheel-fl    anteriore sinistra
wheel-fr    anteriore destra
wheel-rl    posteriore sinistra
wheel-rr    posteriore destra
```

e che l'origine sia al centro del mozzo (altrimenti ruotano sull'asse sbagliato
e oscillano). È il modo più affidabile: la separazione automatica fallisce (e
l'auto resta con le ruote ferme) quando la gomma è topologicamente attaccata al
corpo, quando la ruota è un cubo perfetto o quando il modello ha tre o cinque
ruote.

Sotto ogni ruota il gioco mette anche un'**ombra di contatto**: un quad sfumato
a pochi millimetri dal terreno, perché l'ombra del sole arriva da lontano e nel
punto in cui la gomma tocca l'asfalto lascia sempre un alone chiaro.

### 2.2 Ruota il muso

La convenzione è **muso a +Z**, ma capita di esportare al contrario. Se l'auto
va all'indietro non serve riesportare il file: dal menu **Auto personalizzate**
premi **Ruota il muso 180°**. La scelta è salvata nella scheda del browser
(insieme al GLB) e vale anche al riavvio. Il pulsante compare solo quando la
veicolo corrente è un'auto importata.

### 2.3 Carrozzerie del kit

Le quattro berline low-poly del city kit sono già guidabili dal catalogo:

| Nome nel menu | Slug GLB | Note |
| --- | --- | --- |
| Familiare low-poly | `family-sedan` | ruote separate automaticamente |
| Parigina low-poly | `paris-car-01` | 38k triangoli, separazione più lenta |
| Sedan pastello | `pastel-sedan` | ruote separate automaticamente |
| Spider bianca | `white-sports-convertible` | ruote separate automaticamente |

La berlina fotorealistica `realistic-car-sedan-01` resta **solo in sosta**: è
quella che si guarda da vicino e i suoi pneumatici stanno nei materiali
`rub`/`alloy`, quindi da guidare sembrerebbe un modellino fermo.

Le carrozzerie del kit e quelle importate rispondono anche all'**ambiente
riflesso**: la cubemap del cielo generata da `sky.updateEnvironment` viene
passata ai materiali con un boost diverso per famiglia (vernica, vetri e
lenti molto più delle plastiche), così il clearcoat ha un riflesso vero
invece di sembrare plastica.

---

## 3. Cosa fa l'importazione

Codice: `src/garage.ts`, `Vehicle.buildExternal` in `src/entities/vehicle.ts`,
`buildPaintSwatches`/`importCars` in `src/game.ts`.

1. Legge il `.glb` con `GLTFLoader` (Draco incluso: i GLB compressi funzionano).
2. Misura il bounding box grezzo.
3. Ricava una **scheda tecnica plausibile** (`specForImportedCar`):
   - se la lunghezza grezza è tra 2,8 e 6,2 m la considera in metri, altrimenti
     assume una berlina da 4,2 m (voxel/centimetri/unità arbitrarie);
   - larghezza, altezza, passo, carreggiata e raggio ruota derivano dalle
     proporzioni del modello;
   - massa stimata dal volume; potenza 110 CV, 180 Nm, 185 km/h, 0-100 in 10,2 s.
     **Sono valori di riferimento, non la scheda di un'auto reale.**
4. Orienta il modello (asse lungo su Z, e di 180° se hai premuto **Ruota il
   muso**), lo scala sulla lunghezza dello spec, appoggia la base a y = 0 e lo
   centra.
5. Lo registra nel catalogo a runtime e lo salva in **IndexedDB** insieme al GLB
   originale e al flag del muso: al ricaricamento viene riletto e normalizzato
   di nuovo.
6. Alla prima selezione prova a **separare le ruote** e aggiunge l'ombra di
   contatto sotto di esse.
7. Seleziona l'auto appena importata e la rende guidabile con la fisica di
   `src/sim/car.ts` (stessa frenata, sterzo, cambio e consumo degli altri).

Il modello viene usato **così com'è**: nessun tint automatico, nessuna
sostituzione di materiali, nessuna decimazione. Il colore si sceglie in Smooth
Voxels.

### 3.1 Perché IndexedDB e non il repository

I GLB dell'utente sono file binari, spesso grandi e personali. Tenerli in
IndexedDB:
- non li fa finire in git;
- li rende disponibili a ogni avvio senza ricaricare il file;
- li lega a quel browser/profilo (non sono sincronizzati tra computer).

Per portare un'auto su un'altra macchina si esporta di nuovo il GLB e si
reimporta. Il limite è **12 auto** per browser: oltre, l'import si ferma con un
avviso. Il limite è una scelta di memoria, non tecnica; si alza cambiando
`MAX_IMPORTED_CARS` in `src/garage.ts`.

---

## 4. Cosa manca (e dove metterlo)

| Mancanza | Effetto | Dove intervenire |
| --- | --- | --- |
| Ruote fuse in modo irrecuperabile | restano ferme | esportarle separate con i nomi della §2.1 |
| Nessun interno | vetri vuoti, niente volante | modellare abitacolo e volante nel GLB |
| Tinta non applicabile alle auto importate | il colore è quello del GLB | scelta voluta: `Vehicle.buildExternal` tinge solo la libreria di serie; per tingere anche le importate basta togliere il confronto con `customModel` |
| Fari/luci non emissivi sulle auto importate | di notte lo spot illumina la strada ma il fanale resta scuro | dare ai materiali delle lenti un nome con `lens`/`light`: la libreria di serie lo fa già |
| Nessuna LOD | molti triangoli anche a 100 m | generare LOD nel GLB o aggiungere un `LOD` in `Vehicle` |
| Collisione a scatola | gli spigoli possono compenetrare | `Vehicle.update` usa `spec.width`; servirebbe un box per modello |
| Suono generico | il motore suona come gli altri | `GameAudio` non legge il modello; servirebbe un suono per auto |
| Danni/sospensioni | la carrozzeria non si deforma | fisica attuale rigida, solo inclinazione su 4 punti |
| Nessuna deformazione della gomma | la ruota resta perfettamente tonda al contatto | servirebbe uno squash verticale o una normal map |

Dettaglio e priorità: `docs/ROADMAP-VISUALS.md`.

---

## 5. Problemi tipici

- **L'auto è invisibile o gigantesca**: il file non è un GLB valido o la scena
  ha una scala assurda. L'import ricalcola la lunghezza, ma un modello con
  gerarchia strana può uscire dal campo visivo. Controlla la console: il nome
  del file viene stampato se il parse fallisce.
- **L'auto galleggia o affonda**: la base non è a y = 0. L'importer la appoggia
  sul minimo del bounding box, ma se nel GLB c'è un piano o un'ombra finta sotto
  la carrozzeria, quella diventa la base.
- **Le ruote oscillano invece di sterzare**: l'origine dell'oggetto ruota non è
  al mozzo. Sposta l'origine al centro della ruota nell'editor (o togli i nomi
  `wheel-*` e lascia che sia il gioco a separarle).
- **L'auto va all'indietro e nessun pulsante compare**: il pulsante **Ruota il
  muso 180°** è visibile solo quando il veicolo selezionato è un'auto importata
  (quelle con la stella nella select).
- **Il modello è troppo pesante**: riduci la risoluzione voxel o decima il GLB;
  il gioco non semplifica la geometria importata.
- **L'auto non c'è più dopo aver cambiato browser**: IndexedDB è per profilo.
  Reimporta il GLB.
- **`Elimina importate` non cancella i file**: è voluto, il garage è una copia
  nel browser; i GLB originali restano dove li hai salvati.

---

## 6. Licenza

- I modelli che crei tu sono tuoi: puoi importarli e ridistribuirli come preferisci.
- **Non** mettere nel repository i GLB del city kit (`public/citykit/`): la
  licenza Free Commercial vieta la ridistribuzione dei file. Vale anche per le
  auto del kit usate come base.
- **Auto di serie** (`public/cars/*.glb`): sono file forniti dal proprietario e
  restano fuori da git. Il manifest è versionato, ma **la licenza dei modelli va
  verificata** prima di pubblicare il gioco o una build con gli asset inclusi.
- Smooth Voxels è un servizio esterno: consulta i suoi termini per l'export e
  per l'eventuale uso commerciale dei modelli.
