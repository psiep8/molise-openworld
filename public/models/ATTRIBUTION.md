# Modelli dei personaggi — fonte e licenza

Tutti i file di questa cartella vengono dalla **Ready Player Me Animation Library**
(<https://github.com/readyplayerme/animation-library>), ramo `master`.

| File locale | File originale nel repository | Contenuto |
| --- | --- | --- |
| `uomo.glb` | `masculine/glb/Masculine_TPose.glb` | corpo maschile di riferimento, T-pose |
| `donna.glb` | `feminine/glb/Feminine_TPose.glb` | corpo femminile di riferimento, T-pose |
| `uomo-idle.glb` | `masculine/glb/idle/M_Standing_Idle_001.glb` | in piedi |
| `uomo-walk.glb` | `masculine/glb/locomotion/M_Walk_001.glb` | camminata |
| `uomo-run.glb` | `masculine/glb/locomotion/M_Run_001.glb` | corsa |
| `donna-idle.glb` | `feminine/glb/idle/F_Standing_Idle_001.glb` | in piedi |
| `donna-walk.glb` | `feminine/glb/locomotion/F_Walk_002.glb` | camminata |
| `donna-run.glb` | `feminine/glb/locomotion/F_Run_001.glb` | corsa |

Licenza (testo integrale nel file `LICENSE.md` del repository):

- uso personale e commerciale **gratuito**, ma **solo con avatar Ready Player Me**;
- vietato ridistribuire o vendere le animazioni (anche modificate) come asset a sé
  stanti senza autorizzazione scritta;
- nessuna garanzia.

Questa è una demo locale: i file stanno nel progetto per far girare il gioco, non
sono pubblicati come libreria di animazioni. Se il progetto viene distribuito,
verifica i termini aggiornati sul repository e valuta modelli con licenza CC0.

I corpi di anteprima sono avatar Ready Player Me (la stessa piattaforma usata dall'esempio
`three.js/examples/models/gltf/readyplayer.me.glb`), le clip sono riprese di motion
capture ritargettizzate sulla riga RPM.

## Corpo e clip usati nel gioco

Il giocatore, i pedoni e il conducente usano il modello X Bot e le animazioni
del Locomotion Pack scaricato dal proprietario da Mixamo (Adobe). Le FBX originali
sono conservate in `public/models/locomotion-pack/` e caricate direttamente da Three.js:

| File locale | File fornito | Uso |
| --- | --- | --- |
| `xbot.fbx` | `X Bot.fbx` | corpo riggato |
| `locomotion-pack/idle.fbx` | `idle.fbx` | riposo |
| `locomotion-pack/walking.fbx` | `walking.fbx` | camminata |
| `locomotion-pack/running.fbx` | `running.fbx` | corsa |
| `locomotion-pack/Jump (2).fbx` | `Jump (2).fbx` | salto |
| `locomotion-pack/Walking Up The Stairs.fbx` | idem | salita |
| `locomotion-pack/left turn 90.fbx` | idem | svolta a sinistra |
| `locomotion-pack/Right Turn (2).fbx` | idem | svolta a destra |
| `locomotion-pack/Entering Car.fbx` / `Exiting Car.fbx` | idem | entrata/uscita |
| `locomotion-pack/Driving.fbx` | idem | guida |

Sono incluse anche le altre FBX del pacchetto originale, comprese le varianti non
ancora selezionate dal runtime. Verificare le condizioni Mixamo/Adobe applicabili
alla redistribuzione del progetto.
