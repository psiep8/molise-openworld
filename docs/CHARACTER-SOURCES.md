# Fonti dei personaggi

Stato: 3 novembre 2026. Il runtime usa i corpi realistici MakeHuman
`donna-real.glb` / `uomo-real.glb` e tre clip GLB separate per idle, camminata e
corsa. Non ci sono file Adobe/Mixamo, FBX o una riga sorgente invisibile.

## Asset in uso

- **Corpi MakeHuman** (`public/models/donna-real.glb`, `uomo-real.glb`):
  personaggi completi con pelle, volto, occhi, sopracciglia, ciglia, denti,
  capelli, vestiti e scarpe. Sono generati da MakeHuman con MPFB2 2.0.18 su
  Blender 5.0.1 e usano il rig `mixamo` (52 ossa, nomi `mixamorig:*`). Il runtime
  normalizza il prefisso per collegare le clip.
- **Clip RPM** (`public/models/donna-idle.glb`, `donna-walk.glb`,
  `donna-run.glb`): idle, camminata e corsa associate per nome osso. Le azioni
  non disponibili ricadono su idle o camminata.
- **Fallback RPM** (`public/models/donna.glb`, `uomo.glb`): restano nel repo per
  rollback, ma non vengono più caricati dal percorso di produzione.
- **Sculture Sketchfab** (`public/characters/`): geometrie statiche, senza skin,
  usate solo nella scheda **Sculture** e dietro `?debugbody=1`.
- **Posecode**: il DSL e il renderer del laboratorio del personaggio. Non è un
  modello 3D.

## Licenze

| Componente | Licenza | Stato |
| --- | --- | --- |
| Corpi MakeHuman e accessori dal pack sistema | output CC0; codice MPFB2 GPL-3.0-or-later | in uso |
| Clip RPM | licenza RPM: uso con avatar RPM, niente ridistribuzione come libreria | in uso nella demo; **da sostituire per una release con i corpi MakeHuman** |
| Fallback RPM | CC BY-NC-SA 4.0 per gli avatar del creator web; SDK commerciale separato | non caricato di default |
| Sculture Sketchfab | CC BY 4.0 | attribuzione nel manifest |
| `posecode-parser` 0.6.0 | Apache-2.0 | in uso |
| `posecode-render` 0.6.0 | AGPL-3.0-only | in uso; valutare per un servizio hosted |
| Quaternius | CC0 | candidato per un cast low-poly |
| KayKit | CC0 | candidato per un cast low-poly animato |
| VRoid | licenza per modello | non usato |

## Pipeline MakeHuman / MPFB2

La generazione è avvenuta in locale con Blender 5.0.1 e Python 3.14; MPFB2 è
installato come estensione nel repo `user_default` di Blender. Il pacchetto
`makehuman_system_assets` è stato scaricato dal sito MakeHuman Community (CC0).

Per ciascun sesso lo script:

1. crea un basemesh con macro-parametri di sesso, età, corporatura e carnagione;
2. applica una pelle `GAMEENGINE`;
3. crea il rig `mixamo` e importa i pesi;
4. aggiunge occhi, sopracciglia, ciglia, denti, capelli, vestiti e scarpe CC0;
5. corregge l'altezza della calotta di capelli sulla cima reale della testa;
6. crea una copia di export, cuoce maschere/modificatori e riduce le texture a 1K;
7. esporta un GLB con skin, materiali e texture incorporate.

L'audit dei file:

```bash
npm run characters:audit -- public/models/donna-real.glb public/models/uomo-real.glb
```

I modelli hanno 52 ossa Mixamo e non contengono clip. Il caricamento normale
salta i vecchi pack di capelli separati, perché i nuovi GLB hanno già capelli e
abiti nella gerarchia. La misura dell'altezza usa i limiti delle mesh, non le
origini delle ossa: il rig MakeHuman non ha le punte `HeadTop_End`/`Toe_End`.

## Candidati open source

### Quaternius

<https://quaternius.com/packs/universalbasecharacters.html>. Sei basi umanoidi,
circa 13k triangoli, capelli mix-and-match e rig generico. Dichiarato CC0; gli
outfit sono in un pack separato. Non è un rig RPM per nome.

### KayKit

<https://kaylousberg.com/game-assets/characters-adventurers>. Cinque personaggi
free già vestiti, testurizzati e animati, con atlas 1024×1024. Dichiarato CC0;
il rig è KayKit.

### VRoid

Ogni modello, texture e accessorio ha i termini scelti dal creatore; i metadati
VRM possono dichiarare uso commerciale, modifica e ridistribuzione. Lo stile è
anime/cel-shaded e il rig è VRM.

## Registro decisioni

- **Hero:** MakeHuman/MPFB2 realistico, integrato in `donna-real.glb` /
  `uomo-real.glb`. Il target commerciale non è confermato.
- **Toolchain:** Blender 5.0.1 installato in WSL; MPFB2 2.0.18 caricato come
  estensione; numpy aarch64 cp314 fornito via `PYTHONPATH` a Blender.
- **Runtime:** corpi MakeHuman con rig Mixamo; clip GLB RPM separate. La licenza
  delle clip va risolta prima di una release pubblica con questi corpi.
- **Nessun asset non verificato** è stato aggiunto al repository.
