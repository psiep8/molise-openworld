# Personaggi: corpi, sculture e movimenti Posecode

Lo studio del personaggio è una pagina autonoma del progetto:

```
/characters.html
```

Si apre dal gioco in **Impostazioni → Personaggio → “Apri lo studio del personaggio”**.
È pensata per due pubblici diversi: chi vuole vedere i GLB forniti dal proprietario
e chi vuole controllare i movimenti umani senza avviare il mondo.

## Due schede, due responsabilità

| Scheda | Cosa mostra | Da dove viene |
| --- | --- | --- |
| **Movimento** | Corpi Ready Player Me che recitano otto movimenti Posecode | `public/models/uomo.glb`, `donna.glb` + `src/posecode/movements/*.posecode` |
| **Sculture** | I sette GLB forniti dall'utente (corpi, teste, capelli) come calchi statici | `public/characters/*.glb` + `manifest.json` |

Le sculture **non hanno skin né scheletro**: sono state controllate con
`gltf-transform` e non contengono né `JOINTS_0` né nodi osso. Per questo non si
possono animare senza un rigging manuale (Blender + pesi) e restano nella scheda
statica. Questa galleria di anteprima non cambia il corpo usato nel gioco.

## Corpo animato in gioco: X Bot

Giocatore, pedoni e conducente usano X Bot con scheletro Mixamo. Le clip caricate
direttamente da `public/models/locomotion-pack/` vengono associate per nome osso:
idle, camminata (con varianti), corsa/jogging, salto, strafe, salite, svolte,
avvio/arresto della camminata, ingresso/uscita dall'auto e guida. Il giocatore
seleziona scale e svolte dai movimenti e dall'inclinazione del terreno; la
transizione dell'auto riproduce le clip dedicate. Il conducente viene mostrato
anche nell'abitacolo durante la guida.

I capelli maschili e femminili sono scelti casualmente, per ogni istanza del
personaggio, dalle due librerie GLB in `public/characters/`; colore, scala e
aggancio all'osso della testa vengono applicati al caricamento. Gli asset GLB
Sketchfab e le FBX del Locomotion Pack sono versionati, così sono inclusi nei
pull e nella build senza passaggi d'import manuali.

X Bot è lo stesso corpo usato per entrambe le selezioni di sesso; la mesh non
separa abbastanza regioni per applicare tutti i tagli e gli outfit. I GLB
anatomici importati restano statici nella galleria: per animarli serve rigging e
skinning dedicato, perché la conversione di formato da sola non crea uno
scheletro.

## Asset forniti

Gli originali sorgente stanno in `incoming-glb/characters/` (ignorata da git).
La pipeline li copia in `public/characters/` e scrive un manifest:

```bash
npm run characters          # copia i GLB e rigenera il manifest
node scripts/import-characters.mjs --check   # verifica che i file ci siano
```

I sette GLB in `public/characters/` e il manifest sono versionati, così sono
disponibili dopo un clone o `git pull`; non serve avere gli originali sorgente.
Ogni voce contiene slug, file, autore, fonte, licenza, tipo, altezza di
presentazione (`fitHeight`), se va appoggiata a terra (`ground`) e lo `sha256`
per riconoscere un file sostituito.

### Unità e normalizzazione

I modelli arrivano in scale diverse (un corpo in decimetri, uno in centimetri,
le teste dentro il wrapper Sketchfab ruotato). **I file non vengono modificati**:
lo studio legge `fitHeight` dal manifest, misura il `Box3` del modello caricato,
lo scala su quell'altezza e lo centra. Un corpo alto 1,80 m e una testa alta
27 cm occupano così lo stesso spazio visivo, pur restando nella scala reale.

La camera si allontana in base al bounding sphere; il palco ha un piedistallo
condiviso e, per teste e capelli, un sottile supporto verticale.

### Materiale

Le sculture sono presentate come calchi in argilla (`MeshStandardMaterial`
color terracotta chiaro, roughness alta). Le texture originali vengono
scartate al caricamento e le geometrie del modello precedente vengono liberate
quando se ne sceglie un altro: sfogliare la galleria non accumula VRAM.

## Movimenti Posecode

I documenti sono in `src/posecode/movements/`:

| File | Nome | Gruppo | Durata |
| --- | --- | --- | --- |
| `idle-breathe.posecode` | Respiro a riposo | Postura | 5,8 s (ciclo ×4) |
| `look-around.posecode` | Guardarsi intorno | Postura | 8,0 s |
| `wave.posecode` | Saluto con la mano | Gesti | 5,3 s |
| `walk.posecode` | Camminata naturale | Deambulazione | 1,8 s |
| `run.posecode` | Corsa naturale | Deambulazione | 1,1 s |
| `stretch.posecode` | Allungamento laterale | Quotidiano | 9,5 s |
| `squat.posecode` | Squat a corpo libero | Quotidiano | 3,6 s (ciclo ×3) |
| `pick-up.posecode` | Raccogliere da terra | Quotidiano | 7,0 s |

La durata è quella della timeline costruita da `buildTimeline`, cioè include
l'eventuale segmento di chiusura che riporta il corpo alla posa iniziale. Il
`repeat` del documento indica quante volte l'autore vuole ripetere il ciclo, ma
il viewer lo riproduce comunque in loop continuo: per questo la barra di
avanzamento lavora su un ciclo singolo.

```bash
npm run check:movements
```

Lo script non controlla solo la sintassi: campiona la timeline all'inizio e alla
fine del ciclo e misura la differenza angolare massima. Camminata e corsa sono
a **0,00°** di scucitura, quindi il loop non scatta. Per un movimento nuovo:

1. crea `src/posecode/movements/nome.posecode` (il nome del file diventa lo slug);
2. aggiungi una voce in `MOVEMENT_META` dentro `src/character-studio.ts` per
   gruppo e parola chiave;
3. inserisci lo slug in `MOVEMENT_ORDER` se vuoi un ordine preciso;
4. esegui `npm run check:movements` e `npx tsc --noEmit`.

Il caricamento avviene con `import.meta.glob(..., { query: '?raw', eager: true })`:
i documenti finiscono nel bundle come testo, non servono richieste di rete.

### Comandi nella scheda Movimento

- click su un movimento: lo carica e lo riproduce in loop;
- **Spazio**: play/pausa (fuori da campi di input);
- barra di avanzamento: scrubbing; la velocità va da 0,25× a 1,5×;
- pulsante **Donna / Uomo**: ricrea il viewer con l'altro corpo, mantenendo il
  movimento selezionato.

## Perché due renderer

`createViewer` di `posecode-render` gestisce la scena animata, il rig, il
ground-lock e i contatti. La galleria statica usa invece un piccolo renderer
Three.js dedicato (GLTFLoader + OrbitControls + RoomEnvironment), creato solo
alla prima apertura della scheda **Sculture**. Così chi guarda solo i movimenti
non paga un secondo contesto WebGL né carica i GLB pesanti; chi apre le sculture
può caricare un file da 80 MB senza bloccare il corpo animato.

## Licenze

| Componente | Licenza | Note |
| --- | --- | --- |
| Anteprima Posecode | Ready Player Me | vedi `public/models/ATTRIBUTION.md` |
| Corpo e locomozione in gioco | Mixamo X Bot | file FBX forniti dal proprietario; rispettare le condizioni Mixamo |
| `posecode-parser` 0.6.0 | Apache-2.0 | parsing e validazione del DSL |
| `posecode-render` 0.6.0 | **AGPL-3.0-only** | se il progetto viene esposto come servizio di rete, l'AGPL richiede di offrire il sorgente corrispondente |
| Sculture Sketchfab | CC BY 4.0 | autori e fonti in `ATTRIBUTION.md` e nel manifest |

L'AGPL del renderer è il punto da rileggere prima di una distribuzione pubblica:
per una demo locale o un repository con sorgente aperto non cambia nulla, per un
servizio hosted va valutato con attenzione.
