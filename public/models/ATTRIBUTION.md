# Modelli dei personaggi — fonti e licenze

## Corpi realistici in gioco

Il runtime carica `donna-real.glb` e `uomo-real.glb`, generati per questo
progetto con **MakeHuman** tramite **MPFB2 2.0.18** su Blender 5.0.1. Ogni GLB
contiene corpo, volto, occhi, sopracciglia, ciglia, denti, capelli, vestiti,
scarpe, pelle con texture e scheletro.

| Parte | Asset | Fonte | Licenza |
| --- | --- | --- | --- |
| Corpo base | MakeHuman base mesh | MakeHuman / MPFB2 | output CC0 |
| Pelle | `young_caucasian_female2`, `young_caucasian_male2` | `makehuman_system_assets` | CC0 |
| Capelli | `short03` (entrambi) | `makehuman_system_assets` | CC0 |
| Occhi / sopracciglia / ciglia / denti | `high-poly`, `eyebrow001`, `eyelashes01`, `teeth_base` | `makehuman_system_assets` | CC0 |
| Vestiti | `female_casualsuit01`, `male_casualsuit01` | `makehuman_system_assets` | CC0 |
| Scarpe | `shoes01` | `makehuman_system_assets` | CC0 |

Fonti:

- MakeHuman: <https://static.makehumancommunity.org/makehuman.html>
- MPFB2: <https://github.com/makehumancommunity/mpfb2>
- Pacchetto sistema CC0: <https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html>

Il codice di MPFB2 è distribuito con licenza GPL-3.0-or-later; non è incluso nel
runtime del gioco. Gli asset del pacchetto sistema sono indicati come CC0 nella
pagina della fonte. Il modello esportato è quindi usabile e adattabile senza
attribuzione obbligatoria; questa nota è comunque mantenuta per tracciabilità.

Gli scheletri hanno 52 ossa con nomi Mixamo (`mixamorig:Hips`, `mixamorig:Head`,
...). I GLB non contengono animazioni: il runtime normalizza il prefisso
`mixamorig:` e collega le clip separate.

## Animazioni

`donna-idle.glb`, `donna-walk.glb` e `donna-run.glb` vengono dalla **Ready
Player Me Animation Library** (<https://github.com/readyplayerme/animation-library>).
Sono caricate dal runtime e associate per nome osso a entrambi i corpi.

Licenza delle clip (testo integrale nel repository RPM):

- uso personale e commerciale gratuito **solo con avatar Ready Player Me**;
- vietato ridistribuire o vendere le animazioni, anche modificate, come asset a
  sé stanti senza autorizzazione scritta;
- nessuna garanzia.

Le clip sono ancora nel repository per far funzionare la demo, ma **non sono
licenziate per l'uso con i nuovi corpi MakeHuman**: prima di una distribuzione
pubblica vanno sostituite con clip CC0 o con animazioni realizzate per questo
rig. Questa è una limitazione nota, non una licenza implicita.

## Fallback RPM

`uomo.glb` e `donna.glb` restano nella cartella come fallback storico, ma
`HUMAN_FILES` non li carica più. Gli avatar RPM non dichiarano nel GLB la
provenienza; la FAQ archiviata indicava CC BY-NC-SA 4.0 per gli avatar creati sul
sito, con un percorso commerciale separato per gli sviluppatori registrati. Il
servizio pubblico è stato chiuso il 31 gennaio 2026. Non sono quindi un asset
definitivo per una release commerciale.

## Sculture e file non caricati

La geometria in `public/characters/` è usata solo dalla scheda **Sculture** e
dietro `?debugbody=1`. Non fa parte del personaggio di produzione: non ha skin,
volto o texture complete.

Nessun file Adobe/Mixamo o FBX viene usato dal runtime. I vecchi pack di capelli
separati non vengono più applicati ai corpi MakeHuman, che hanno già i capelli
cotti nel GLB.
