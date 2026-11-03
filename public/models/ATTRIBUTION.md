# Modelli dei personaggi — fonte e licenza

Questa cartella contiene i GLB del gioco. Il runtime carica esclusivamente questi
file: non ci sono file di animazione esterni né dipendenze da una riga sorgente.

## Corpi e animazioni

I corpi e le clip vengono dalla **Ready Player Me Animation Library**
(<https://github.com/readyplayerme/animation-library>), ramo `master`.

| File locale | File originale nel repository | Contenuto |
| --- | --- | --- |
| `uomo.glb` | `masculine/glb/Masculine_TPose.glb` | corpo maschile completo, T-pose |
| `donna.glb` | `feminine/glb/Feminine_TPose.glb` | corpo femminile completo, T-pose |
| `uomo-idle.glb` | `masculine/glb/idle/M_Standing_Idle_001.glb` | in piedi |
| `uomo-walk.glb` | `masculine/glb/locomotion/M_Walk_001.glb` | camminata |
| `uomo-run.glb` | `masculine/glb/locomotion/M_Run_001.glb` | corsa |
| `donna-idle.glb` | `feminine/glb/idle/F_Standing_Idle_001.glb` | in piedi |
| `donna-walk.glb` | `feminine/glb/locomotion/F_Walk_002.glb` | camminata |
| `donna-run.glb` | `feminine/glb/locomotion/F_Run_001.glb` | corsa |

Il runtime usa `donna-idle.glb`, `donna-walk.glb` e `donna-run.glb` per entrambi
i sessi: le tracce vengono associate per nome osso allo scheletro del corpo scelto.
Le azioni non presenti usano `idle` o `walk`.

Licenza delle clip (testo integrale nel file `LICENSE.md` del repository):

- uso personale e commerciale **gratuito**, ma **solo con avatar Ready Player Me**;
- vietato ridistribuire o vendere le animazioni (anche modificate) come asset a sé
  stanti senza autorizzazione scritta;
- nessuna garanzia.

Questa è una demo locale: i file stanno nel progetto per far girare il gioco, non
sono pubblicati come libreria di animazioni. Se il progetto viene distribuito,
verifica i termini aggiornati sul repository e valuta modelli con licenza CC0.

I corpi di anteprima sono avatar Ready Player Me, le clip sono riprese di motion
capture ritargettizzate sulla riga RPM.

## Stato corrente del corpo visibile

- **Corpo disegnato in gioco**: `uomo.glb` / `donna.glb`, personaggi RPM
  completi (una mesh, un materiale, due texture embedded, volto e vestiti
  nell'atlante). Misure verificate: uomo 1,690 m / 58 ossa, donna 1,610 m /
  60 ossa. Il corpo ha circa 11,1k triangoli.
- **Animazioni**: i tre GLB `donna-*` vengono caricati dal percorso normale;
  non viene costruito alcun rig sorgente invisibile. Le clip di salto, svolta,
  salita e guida non sono più disponibili e ricadono su idle/walk.
- **Scultura Sketchfab**: la geometria di `public/characters/` non è il corpo di
  produzione: non ha skin né texture e non viene caricata senza
  `?debugbody=1`.

## Licenza degli avatar

I corpi RPM non dichiarano nel GLB la provenienza (creator web o SDK). La FAQ
archiviata di Ready Player Me indicava CC BY-NC-SA 4.0 per gli avatar creati sul
sito e un percorso commerciale separato per gli sviluppatori registrati; il
servizio pubblico è stato chiuso il 31 gennaio 2026. I file sono quindi usati
qui come fallback completo per una demo non commerciale, con attribuzione, ma
non sono un asset definitivo per una release commerciale. La maglietta RPM
contiene inoltre il marchio "READY PLAYER ME": non è un costume finale.

Le teste sculpt da 59/82 MB non vengono caricate dal gioco: costano memoria e
non sono animate. Se in futuro serviranno, vanno decimate, texturizzate e
rigate.
