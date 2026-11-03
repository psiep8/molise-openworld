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

Il giocatore, i pedoni e il conducente usano i corpi `uomo.glb` / `donna.glb`.
X Bot non è disegnato: il suo FBX resta la riga sorgente invisibile del retarget.
Le animazioni vengono dal Locomotion Pack Mixamo (Adobe), conservato in
`public/models/locomotion-pack/` e caricato direttamente da Three.js:

| File locale | File fornito | Uso |
| --- | --- | --- |
| `xbot.fbx` | `X Bot.fbx` | riga sorgente per il retarget (non disegnata) |
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

## Stato corrente del corpo visibile (B1)

- **Corpo disegnato in gioco**: `uomo.glb` / `donna.glb` (avatar GLB con skin,
  scheletro Mixamo-compatibile). Sono gli unici corpi aggiunti alla scena.
  Misure: uomo 1,690 m / 58 ossa, donna 1,610 m / 60 ossa; le 52 ossa della
  clip di camminata sono presenti su entrambi.
- **X Bot** (`xbot.fbx`): conservato solo come riga sorgente invisibile per il
  calcolo del retarget delle clip. Non viene disegnato.
- **Corpi anatomici Sketchfab** in `public/characters/`: mesh statiche senza
  skin; restano nella galleria Sculture. Per animarle va prodotto un GLB
  riggato con scheletro Mixamo (auto-rigger Mixamo o trasferimento pesi in
  Blender) e va verificata la licenza di ciascun asset.
- **Locomotion Pack**: FBX Mixamo fornite dal proprietario del progetto. Prima
  di una distribuzione pubblica verificare i termini Mixamo/Adobe vigenti sulla
  ridistribuzione dei file e delle animazioni.

Le teste sculpt da 59/82 MB non vengono caricate dal gioco: costano memoria e
non sono animate. Se in futuro serviranno, vanno decimate e riggate.
