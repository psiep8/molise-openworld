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
statica. La geometria non viene più vestita con materiali e capi procedurali nel
percorso di produzione: il corpo visibile in gioco è il personaggio RPM
completo. La vecchia pelle importata resta solo come confronto dietro
`?debugbody=1`.

## Corpo animato in gioco: RPM completo

Giocatore, pedoni e conducente usano i personaggi completi
`public/models/uomo.glb` e `donna.glb`: una sola mesh con pelle, volto, capelli e
vestiti nella texture, più lo scheletro RPM. Le clip GLB RPM di idle, camminata
e corsa vengono associate per nome osso; le azioni non disponibili usano idle o
camminata. Le due selezioni di sesso hanno corpi diversi. La scultura Sketchfab
senza testa e senza vestiti non è più il corpo di produzione: si può vedere solo
con `?debugbody=1`.

Il materiale RPM è un unlit con una normal map embedded non collegata; il
runtime la aggancia e lo porta a `MeshStandardMaterial`, così il corpo reagisce
alla luce. I vestiti sono ancora una texture unica (non mesh separabili) e la
maglietta contiene il marchio RPM: per questo il corpo è un fallback, non
l'asset finale.

Misure verificate sullo scheletro in T-pose: **uomo 1,690 m / 58 ossa**,
**donna 1,610 m / 60 ossa**. Il test `tests/human-model-rpm.test.ts` verifica
che i tre GLB di animazione contengano clip e che il progetto non carichi file
di animazione esterni.

Il vecchio rig procedurale ("umano custom") è stato rimosso dal percorso di
produzione: si può vedere solo con `?debugrig=1`.

### Caricamento robusto

`loadHumanAssets` usa `Promise.allSettled` per asset:

- corpi: obbligatori; se manca un GLB il gioco mostra un errore esplicito e
  riprova dopo 6 secondi (fino a tre tentativi), senza costruire un manichino;
- clip: un GLB mancante ricade sulla clip di riposo;
- capelli: opzionali; se il pack da 20 MB non si carica, il personaggio resta
  senza capelli ma il resto funziona.

I capelli maschili e femminili sono scelti in modo deterministico per istanza
dalle due librerie GLB in `public/characters/` e agganciati all'osso Head;
colore e scala vengono applicati al caricamento.

La geometria anatomica di `public/characters/` non ha skin né scheletro e vive
nella scheda **Sculture** dello studio. Per un personaggio vero serve un rigging
con trasferimento pesi (Blender) e, soprattutto, UV,
texture del volto e vestiti: il solo trasferimento del vertice più vicino non è
sufficiente. Fonti e limiti di licenza sono in
[`CHARACTER-SOURCES.md`](CHARACTER-SOURCES.md).

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
| Corpo in gioco | Ready Player Me (`uomo.glb`, `donna.glb`) | completo, ma con licenza RPM condizionata: fallback solo demo non commerciale; vedi [`CHARACTER-SOURCES.md`](CHARACTER-SOURCES.md) |
| Animazioni | GLB RPM (`donna-idle/walk/run`) | clip usate con i corpi RPM; licenza RPM da verificare prima della release |
| `posecode-parser` 0.6.0 | Apache-2.0 | parsing e validazione del DSL |
| `posecode-render` 0.6.0 | **AGPL-3.0-only** | se il progetto viene esposto come servizio di rete, l'AGPL richiede di offrire il sorgente corrispondente |
| Sculture Sketchfab | CC BY 4.0 | autori e fonti in `ATTRIBUTION.md` e nel manifest |

L'AGPL del renderer è il punto da rileggere prima di una distribuzione pubblica:
per una demo locale o un repository con sorgente aperto non cambia nulla, per un
servizio hosted va valutato con attenzione.
