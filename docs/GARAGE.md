# Garage: auto di serie su GLB e auto importate

Il gioco ha **due librerie di auto separate**, che non vanno confuse:

| | Auto di serie (`public/cars/`) | Auto importate (IndexedDB) |
| --- | --- | --- |
| Chi le mette | gli sviluppatori, come asset del gioco | il giocatore, dal menu o drag & drop |
| Dove vivono | file `.glb` + `manifest.json` versionato | IndexedDB del browser, max 12 |
| Come si scelgono | select **Veicolo**, senza prefisso | select **Veicolo**, prefisso `★` |
| Si possono eliminare | no | sì, con **Elimina importate** |
| Fisica | scheda tecnica reale in `vehicle-catalog.ts` | scheda stimata dagli ingombri |
| Licenza | da verificare prima della distribuzione | dell'utente |

Le auto di serie si caricano una volta e vengono **normalizzate** (unità di
lunghezza, muso a +Z, base a `y = 0`, centrate in x/z); la scala finale viene
dalla lunghezza dello spec. La selezione è asincrona e usa un **generation
counter**: cambiando auto in fretta dal menu non si rischia di applicare un GLB
vecchio sopra quello nuovo. Se il file manca (repo clonato senza asset), il
gioco ricade sulla sagoma procedurale dello stesso spec senza errori.

### Modelli di serie

| Nome | Slug / `model` | File | `yaw` | Lunghezza |
| --- | --- | --- | --- | --- |
| Fiat Punto | `fiat-punto` | `fiat-punto.glb` | 0 | 3,80 m |
| Lamborghini Aventador | `lamborghini-aventador` | `lamborghini-aventador.glb` | 0 | 4,78 m |
| Ferrari 458 Spider | `ferrari-458` | `ferrari.glb` | 180 | 4,53 m |
| Land Rover Defender | `land-rover-defender` | `land-rover-defender.glb` | 0 | 5,02 m |
| Audi R8 V10 Performance | `audi-r8` | `audi-r8.glb` | 0 | 4,43 m |
| Cupra Terramar | `cupra-terramar` | `cupra-terramar.glb` | 90 | 4,52 m |

`yaw` è la rotazione attorno a Y (gradi) che porta il muso del modello verso
**+Z**: il manifest è l'unico posto da toccare se un modello guarda dalla parte
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

I file `.glb` sono in `.gitignore`, il manifest è versionato. **La licenza dei
modelli va verificata** prima di una distribuzione pubblica.

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
| Nessuna tinta runtime | il colore è quello del GLB | `Vehicle.paintable` è `false` per i modelli esterni |
| Fari/luci non emissivi | di notte lo spot illumina la strada ma il fanale resta scuro | aggiungere materiali emissivi al GLB o mapparli in `buildExternal` |
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
