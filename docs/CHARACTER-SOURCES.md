# Fonti dei personaggi

Stato: 3 novembre 2026. Il runtime usa i corpi RPM completi e tre clip GLB RPM;
non ci sono file di animazione esterni né una riga sorgente invisibile.

## Asset in uso

- **RPM** (`public/models/donna.glb`, `uomo.glb`): unico personaggio completo già
  presente, con volto, occhi, capelli e vestiti nella texture. Lo scheletro è RPM.
  È il fallback di produzione, non una soluzione definitiva: la licenza degli
  avatar creati sul sito era CC BY-NC-SA 4.0, il servizio pubblico è stato chiuso
  il 31 gennaio 2026 e i file non dichiarano la provenienza.
- **Clip RPM** (`public/models/donna-idle.glb`, `donna-walk.glb`,
  `donna-run.glb`): idle, camminata e corsa associate per nome osso. Le azioni
  non disponibili ricadono su idle o camminata.
- **Sculture Sketchfab** (`public/characters/`): geometrie statiche, senza skin,
  usate solo nella scheda **Sculture** e dietro `?debugbody=1`. Autori, fonti e
  licenze sono nel manifest e in [`public/models/ATTRIBUTION.md`](../public/models/ATTRIBUTION.md).
- **Posecode**: il DSL e il renderer del laboratorio del personaggio. Non è un
  modello 3D.

## Licenze

| Componente | Licenza | Stato |
| --- | --- | --- |
| Corpi RPM | CC BY-NC-SA 4.0 per gli avatar del creator web; SDK commerciale separato | fallback demo; non commerciale |
| Clip RPM | licenza RPM: uso con avatar RPM, niente ridistribuzione come libreria | nel repo per la demo; da verificare prima della release |
| Sculture Sketchfab | CC BY 4.0 | attribuzione nel manifest |
| `posecode-parser` 0.6.0 | Apache-2.0 | in uso |
| `posecode-render` 0.6.0 | AGPL-3.0-only | in uso; valutare per un servizio hosted |
| MakeHuman/MPFB2 | output CC0; accessori con licenze proprie | candidato hero, non ancora integrato |
| Quaternius | CC0 | candidato per un cast low-poly |
| KayKit | CC0 | candidato per un cast low-poly animato |
| VRoid | licenza per modello | non usato |

## Candidati open source

### MakeHuman / MPFB2

Scelta per il corpo realistico. Le esportazioni di MakeHuman sono CC0; il codice
è AGPL/GPL. MPFB2 richiede Blender 4.2+ e gli asset pack vanno verificati uno per
uno. Abiti, capelli e texture della community possono avere licenze proprie.

Criterio di accettazione per il GLB:

- mesh completa con pelle, volto, occhi, capelli e vestiti;
- una sola scena, skin e scheletro con Hips/Head;
- materiali separati per pelle, occhi, capelli, maglia, pantaloni e scarpe;
- LOD0 ≤ 40k triangoli, file ≤ 15 MB;
- licenza dell'asset e di ogni accessorio documentata;
- passaggio obbligatorio da `npm run characters:audit`.

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

## Audit e ottimizzazione

```bash
npm run characters:audit
npm run characters:optimize -- --input public/models/donna.glb --out /tmp/donna-opt.glb
```

`character-assets.mjs` controlla skin, scheletro, texture, materiali, triangoli e
budget. `optimize` riduce i vertici e preserva skin e texture; non crea LOD, non
riga e non autorizza la ridistribuzione di asset di terzi.

## Registro decisioni

- **Hero:** MakeHuman/MPFB2 realistico. Il target commerciale non è confermato;
  la regola prudente resta demo non commerciale finché la licenza non è decisa.
- **Toolchain:** su questa macchina non ci sono Blender né MakeHuman. Il pacchetto
  Blender ARM64 estratto in `.tools` non partiva per librerie condivise mancanti;
  il toolchain temporaneo è stato rimosso. Non è stato generato un GLB MakeHuman.
- **Runtime:** RPM completo come fallback; clip GLB RPM per idle/camminata/corsa.
- **Nessun asset non verificato** è stato aggiunto al repository.
