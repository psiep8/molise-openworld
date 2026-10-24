# Roadmap visuale: auto, ambiente e gli esempi three.js

Documento di lavoro, non una promessa. Elenca **cosa manca davvero** alle auto
del kit e come i riferimenti three.js indicati dal proprietario possono colmare
lacune concrete del progetto. Ogni voce dice dove si tocca il codice, quanto
costa e cosa si rischia.

Stato di partenza: il gioco usa **`THREE.WebGLRenderer`** (`src/game.ts`), un DEM
reale con ortofoto ESRI (`src/world/terrain.ts`, `src/world/imagery.ts`), strade
e impronte OSM, un city kit PBR (**38 asset**, di cui 8 case/rimesse e 6 alberi
da campo) e un catalogo di **31 veicoli guidabili** (21 procedurali, 6 su GLB e
4 carrozzerie del kit), più le auto importate dal garage.

---

## 1. Cosa manca alle auto del kit

Fatti verificati decodificando i GLB in `public/citykit/` (nodi e mesh del
chunk JSON):

| Asset | Nodi | Triangoli | Ruote separate | Interni | Luci |
| --- | --- | --- | --- | --- | --- |
| `family-sedan` | 1 | 2.424 | no | no | no |
| `paris-car-01` | 1 | 38.575 | no | no | no |
| `pastel-sedan` | 1 | 7.144 | no | no | no |
| `white-sports-convertible` | 1 | 6.904 | no | no | no |
| `realistic-car-sedan-01` | 17 nodi | 65.137 | fuse in `rub`/`alloy` | sì (`cabin`, `seat`) | sì (`lensRed`, `lensAmb`, `emitW`) |

Le quattro low-poly sono **un solo oggetto**: la carrozzeria e le ruote sono la
stessa mesh. Da qui, in ordine di impatto:

### 1.1 Ruote che girano e sterzano ✅ Fatto a runtime

Non servono più asset separati: `src/entities/car-wheels.ts` analizza la
carrozzeria unica, isola le componenti triangolari a forma di ruota (due assi
larghi e uno stretto, nella parte bassa), le assegna ai quattro angoli e crea
un perno al centro del mozzo. Le ruote girano e sterzano, e il **raggio viene
misurato dal modello**, quindi il rotolamento combacia con l'asfalto invece di
strisciare. Sotto ogni ruota c'è anche un'ombra di contatto.

Cosa resta fragile (da correggere in Blender o modellando meglio):

- **gomma attaccata al corpo**: se la ruota condivide vertici con la carrozzeria
  fa parte della stessa componente e non viene separata → ruote ferme;
- **ruota a cubo perfetto**: tre assi uguali non passano il filtro e vengono
  scartate;
- **tre o cinque ruote** (trikey, camion): vengono cercate solo quattro ruote,
  un modello fuori dallo schema resta com'era;
- **rima e pneumatico separati** vengono uniti nello stesso perno, ma se hanno
  centri diversi il cerchio gira fuori asse;
- i vecchi file con ruote già separate e nominate `wheel-fl`… continuano a
  funzionare come prima, con l'origine al mozzo.

Costo: zero asset. La separazione costa ~0,1 s per una carrozzeria low-poly e
viene fatta una volta sola sul template.

### 1.2 Interni e volante (P1, vista interna/terza persona)

`realistic-car-sedan-01` ha `cabin`, `seat`, `glass`; le low-poly no. In terza
persona il vetro scuro nasconde il vuoto, ma in prima persona (se si aggiunge)
si vedrebbe subito. Costo: asset. Codice: agganciare la telecamera all'abitacolo
e nascondere il tetto.

### 1.3 Fari e fanalini emissivi (P1, notte)

Il gioco aggiunge due `SpotLight` alla carrozzeria esterna, quindi la strada si
illumina. Ma il fanale del GLB resta un materiale opaco: di notte sembra
spento. Per la berlina fotorealistica ci sono già `lensRed`, `lensAmb`, `emitW`,
`lensClear`; per le low-poly niente. Soluzione: in `buildExternal`, cercare i
materiali con nome che contiene `lens`/`emit` e alzare `emissiveIntensity` con
`setLights`, come si fa per la carrozzeria procedurale. Costo: mezza giornata.

### 1.4 Tinta della carrozzeria (P1)

`spec.model` usa il GLB così com'è: la palette del menu non lo tocca
(`Vehicle.paintable` è `false`). Per la berlina fotorealistica la parte
`car_sedan_01_paint` è già tintabile nelle istanze del parcheggio; per le
low-poly la texture è un atlante unico, tingere il materiale colorerebbe tutta
l'auto. Opzioni:

1. accettare il colore del GLB (stato attuale, documentato);
2. rifare le auto con la carrozzeria su un materiale separato, come la berlina;
3. tingere solo le parti con nome `paint`/`body` e lasciare il resto.

La 2 è l'unica che dà un risultato pulito. Costo: asset.

### 1.5 LOD e costo (P2)

`paris-car-01` è **38.575 triangoli** per un'auto low-poly: più della berlina
fotorealistica in alcune configurazioni. Se si guida con 17 modelli e si
importano auto da 80k, servono LOD: mesh piena entro 40 m, versione a 2k oltre
120 m, scatola oltre 300 m. three.js ha `THREE.LOD`; il costo è la preparazione
dei modelli. Oggi non c'è LOD né per le auto del kit né per quelle importate.

### 1.6 Collisioni, danni, sospensioni, suono (P2)

- La collisione è un cerchio di `spec.width` contro gli edifici; le altre auto
  non sono solide. Un'auto importata può attraversare un muro se il cerchio è
  più stretto della carrozzeria.
- Non c'è deformazione: l'auto si inclina su 4 punti (`tiltPitch`/`tiltRoll`),
  non ha sospensioni indipendenti né danni.
- ✅ **Suono per modello (24/10)**: `engineVoice(spec)` ricava cilindri,
  regimi e peso timbrico dalla scheda; il sintetizzatore usa la frequenza di
  accensione reale (`rpm/60 × cilindri/2`). Restano da fare i campioni audio
  dedicati per i sei GLB, se in futuro arriveranno dei file.

### 1.7 Animazioni (P2)

Nessun GLB ha clip. Porte, cofano, tergicristalli e sospensioni sono fermi. Non
è prioritario per un gioco di guida, ma è la differenza tra un modello statico e
un'auto viva.

---

## 2. Gli otto riferimenti three.js

Sono **esempi didattici**, non moduli pronti da importare. Le versioni `webgpu_*`
usano `WebGPURenderer` e TSL: non girano sul `WebGLRenderer` attuale. Le versioni
`webgl_*` sono compatibili con il renderer del progetto.

### 2.1 `webgl_materials_car` — P0, il più redditizio

<https://threejs.org/examples/webgl_materials_car.html>

**Cosa mostra**: vernice auto fisica (clearcoat, metalness, roughness), vetri,
cerchioni e interni con `MeshPhysicalMaterial`, illuminazione da studio e
ambiente riflesso.

**Stato**: ✅ fatto. Il cielo genera già una cubemap PMREM
(`sky.updateEnvironment` → `scene.environment`); la carrozzeria adesso riceve
lo stesso ambiente con un boost: vernice 2,4×, vetri e cromature 3×,
lenti 1,9× (`Vehicle.setEnvironment` + `tune`). Il clearcoat è salito a 1,0
con `clearcoatRoughness` 0,06 e la vernice metalness 0,5.

**Cosa resta**:
1. provare `transmission` per i vetri (ora è opacità + riflessi): costa un pass
   extra di scena ma il vetro è più credibile;
2. alzare la risoluzione del PMREM o rigenerarlo con un cubemap dedicato al
   veicolo in modalità garage (studio chiuso, riflessi più definiti);
3. applicare lo stesso trattamento ai materiali delle auto in sosta (oggi solo
   il veicolo del giocatore ha il boost).

Costo residuo: 1–2 giorni. Rischio: medio-basso.

### 2.2 `webgl_geometry_terrain` — P1, solo orizzonte

<https://threejs.org/examples/webgl_geometry_terrain.html>

**Cosa mostra**: terreno procedurale con rumore, volo in prima persona, LOD
geometrico.

**Cosa manca oggi**: il terreno è reale (DEM + ortofoto) e va lasciato vero. Ma
oltre il raggio di streaming (VIEW_RADIUS) c'è il vuoto o il fog. L'esempio
serve a costruire una **cintura di montagne lontane** a bassa risoluzione, non a
sostituire il DEM: rumore fractal + colore per quota, senza texture, oltre 4–8
km, agganciata alla quota media del DEM ai bordi per non avere gradini.

**Dove**: nuovo `src/world/far-terrain.ts`, aggiunto in `game.ts` dopo
`Terrain`; materiale non illuminato o con nebbia, `frustumCulled` gestito a
mano, una sola mesh da ~2k triangoli. Costo: 1 giorno. Rischio: basso.

### 2.3 `webgpu_compute_particles_rain` — P2, solo se si passa a WebGPU

<https://threejs.org/examples/webgpu_compute_particles_rain.html>

**Cosa mostra**: particelle di pioggia in compute shader, migliaia di gocce
senza costo CPU.

**Cosa c'è oggi**: `src/world/precipitation.ts` usa `THREE.Points` con buffer
geometrici aggiornati a mano (pioggia e neve). Per un paese e una vista in terza
persona è sufficiente; il collo di bottiglia non è la pioggia.

**Come usarlo**: solo dopo una migrazione a `WebGPURenderer` (vedi §3), con
storage buffer per posizioni/velocità e un compute pass. In WebGL si può
ottenere un effetto simile con un vertex shader che anima le gocce, senza
compute: costo minore, resa simile. Costo WebGPU: 3–4 giorni + migrazione.
Rischio: alto. **Non prioritario.**

### 2.4 `webgpu_compute_particles_snow` — P2

<https://threejs.org/examples/webgpu_compute_particles_snow.html>

Stessa valutazione della pioggia. La neve del progetto ha già accumulo e vento;
il compute darebbe densità e turbolenza, non un salto di qualità percepibile a
questa scala. Rimandare.

### 2.5 `webgpu_custom_fog` — P1, ma portabile in WebGL

<https://threejs.org/examples/webgpu_custom_fog.html>

**Cosa mostra**: nebbia custom con densità per quota, non la `Fog` lineare.

**Cosa c'è oggi**: `scene.fog = new THREE.Fog(...)` con near/far ricalcolati dal
meteo (`updateAtmosphere` in `game.ts`). Funziona, ma è uniforme: la valle non
ha nebbia bassa, i crinali non emergono.

**Come usarlo senza WebGPU**: un chunk `onBeforeCompile` sui materiali
principali (terreno, edifici, alberi) che miscela il colore con la nebbia in
base a `height` e distanza, oppure un pass fullscreen che ricostruisce la
profondità. Il secondo è più pulito ma richiede il `PostPipeline` esistente
(`src/gfx/post.ts`). Costo: 1–2 giorni. Rischio: medio (shader chunk da tenere
allineati a three r186). **Da fare dopo l'ambiente delle auto.**

### 2.6 `webgl_animation_skinning_blending` — P1

<https://threejs.org/examples/webgl_animation_skinning_blending.html>

**Cosa mostra**: crossfade tra clip di camminata/corsa con `AnimationMixer`.

**Cosa c'è oggi**: `HumanBody` ha già idle/walk/run e un blend esponenziale dei
pesi (`src/entities/human-model.ts`). Quindi la base c'è. Manca il **crossfade
con sincronizzazione del passo**: oggi i pesi si sommano senza allineare il
tempo delle clip, e il passaggio walk→run può scattare. L'esempio mostra
`crossFadeTo` e `syncWith`; applicarlo a `HumanBody.update` (quando cambia
target, sincronizzare il tempo normalizzato) è un intervento piccolo e visibile.

Costo: mezza giornata. Rischio: basso. Priorità alta perché i pedoni sono
ovunque.

### 2.7 `webgl_animation_skinning_additive_blending` — P2

<https://threejs.org/examples/webgl_animation_skinning_additive_blending.html>

**Cosa mostra**: animazioni additive sopra la locomozione (respirazione,
look-at, inclinazione).

**Cosa manca**: i pedoni non guardano il giocatore, non respirano e non si
inclinano in curva. Servono clip additive e un rig con i bone giusti; il modello
umano attuale viene da un GLB con skeleton (c'è `cloneSkeleton`), quindi la
strada è aperta.

**Come usarlo**: un layer additivo con peso 0,2–0,4 per il look-at della testa
quando il giocatore è entro 6 m, e per la respirazione da fermi. Costo: 2–3
giorni (dipende dalle clip). Rischio: medio. Da fare dopo il crossfade.

### 2.8 `webgpu_generator_building` — P2, non per Palata

<https://threejs.org/examples/webgpu_generator_building.html>

**Cosa mostra**: generatore procedurale di edifici (volumi, facciate, dettagli)
con WebGPU/TSL.

**Perché non è prioritario**: le case di Palata hanno l'**impronta OSM vera**.
Sostituirle con edifici generati significa inventare un altro paese, lo stesso
motivo per cui le case low-poly del kit restano fuori (`docs/CITYKIT.md` §1.4).
Il generatore può servire per:
- **dettaglio di facciata** su edifici esistenti (balconi, cornicioni, persiane)
  generati in base a larghezza/altezza, non per cambiare l'impronta;
- **edifici di sfondo** fuori dal paese, dove l'occhio non arriva.

Richiede WebGPU e un cambio di renderer. Costo: alto. Rischio: alto. Rimandare a
quando il resto è chiuso.

---

## 3. WebGPU: cosa comporterebbe

I tre esempi `webgpu_*` non sono compatibili con `WebGLRenderer`. three.js offre
`WebGPURenderer` (import `three/webgpu`), ma:

- è un **secondo renderer**, non un flag: materiali, post-processing e shader
  custom vanno rivisti;
- il progetto ha un `PostPipeline` WebGL (`src/gfx/post.ts`) e materiali con
  `onBeforeCompile` (bagnatura strade, city kit): su WebGPU si traducono in TSL
  o si perdono;
- il fallback per browser senza WebGPU va mantenuto, altrimenti il gioco non
  parte su macchine vecchie;
- il guadagno oggi sarebbe su pioggia/neve e generator di edifici, non sul
  collo di bottiglia reale (draw call, ombre, streaming immagini).

**Raccomandazione**: restare su WebGL e portare le idee, non il renderer. Solo
se in futuro si vuole un secondo percorso "ultra" si può aggiungere
`WebGPURenderer` dietro un preset, con il WebGL come default.

---

## 4. Ordine consigliato

| Priorità | Intervento | Costo | Perché |
| --- | --- | --- | --- |
| ✅ | Vernice fisica + ambiente riflesso (`webgl_materials_car`) | fatto | clearcoat 1,0 e cubemap del cielo con boost per famiglia |
| ✅ | Ruote separate + ombra di contatto | fatto | separazione a runtime (`car-wheels.ts`), raggio reale |
| ✅ | Correzione del muso per le auto importate | fatto | pulsante 180° salvato nel browser |
| P1 | Fari emissivi per i GLB | 0,5 g | la notte è metà del gioco |
| P1 | Crossfade sincronizzato dei pedoni | 0,5 g | i pedoni sono ovunque |
| P1 | Cintura di montagne lontane (`webgl_geometry_terrain`) | 1 g | toglie il vuoto oltre il DEM |
| P1 | Nebbia per quota (`webgpu_custom_fog` portato in WebGL) | 1–2 g | atmosfera da valle |
| P2 | LOD auto, collisioni per modello | 2–3 g | qualità a distanza |
| ✅ | Suono per auto | fatto | cilindri/regimi reali dalla scheda |
| P2 | Look-at additivo dei pedoni | 2–3 g | vita nelle piazze |
| P2 | Pioggia/neve compute, generatore edifici | 3–6 g + WebGPU | rimandare |

---

## 5. Cosa non fare

- **Non** sostituire il DEM con `webgl_geometry_terrain`: la geografia vera è il
  punto del progetto.
- **Non** generare edifici al posto delle impronte OSM.
- **Non** passare a WebGPU per la pioggia: il costo di migrazione è molto più
  alto del beneficio.
- **Non** tingere le low-poly del kit a runtime: l'atlante unico colorerebbe
  anche vetri e gomme.
- **Non** mettere in repo i GLB del kit: la licenza vieta la ridistribuzione.
