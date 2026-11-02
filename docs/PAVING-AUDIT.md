# Marciapiedi: audit dei moduli e regole di piazzamento

Stato dopo F20-bis. Il manto d'asfalto e la fisica restano procedurali
(`src/world/roads.ts`); i moduli GLB sono la pelle visibile del marciapiede nei
tratti urbani.

## I sette moduli del kit

Misure dal manifest (dopo `normalize: footprint`) e texture verificate sui GLB.

| slug | larghezza × lunghezza × altezza | texture | triangoli | uso |
| --- | --- | --- | --- | --- |
| `sidewalk-8m` | 1,54 × 8,1 × 0,35 m | cemento rotto, erbacce (fotogrammetria) | 11.519 | escluso: 35 cm di spessore e peso |
| `sidewalk-long` | 0,98 × 6,1 × 0,14 m | lastre chiare con toppe d'asfalto | 11.512 | escluso: scan pesante, non ripetibile |
| `sidewalk-module-a` | 6,03 × 10,52 × 0,14 m | atlante "Road Modular" | 10 | usato come lastra, scalata in larghezza |
| `sidewalk-module-b` | 6,03 × 16,9 × 0,14 m | stesso atlante, altra regione | 10 | alternativa alla a (una per via) |
| `curb-modular-long` | 0,06 × 5,43 × 0,23 m | calcestruzzo grigio pulito | 1.080 | usato per i cordoli |
| `curb-modular-short` | 0,06 × 1,14 × 0,23 m | stesso calcestruzzo | 216 | alternativa per curve strette |
| `curb-stone` | 0,15 × 2,8 × 0,16 m | roccia scura (scan) | 19.002 | escluso: 19k triangoli per un cordolo |

Filtro attuale: `asset.triangles <= 1500`, quindi entrano solo i moduli a/b e i
due cordoli modulari. Gli scan fotogrammetrici restano nel kit per eventuali
primi piani, non per catene lunghe.

## Regole implementate

- **Una variante per via.** La variante (a o b, cordolo lungo o corto) è scelta
  da `stableChoice` su indice, nome e larghezza della strada: tutti i moduli
  della stessa via hanno la stessa pavimentazione, e la scelta non cambia al
  reload. Prima `assets[laid % assets.length]` alternava a/b ogni modulo.
- **Niente buchi in salita.** Il taglio `slopeAt > 12°` è stato rimosso: era la
  causa diretta dei marciapiedi interrotti sui tratti ripidi.
- **Piano stradale, non pitch per asse.** Pendenza longitudinale e traversale
  danno `slopeX/slopeZ` (`slopeFrame`), quindi il modulo segue la strada anche
  quando corre parallela all'asse X; il vecchio `pitch` con segno dipendente
  dall'asse del modello sbagliava inclinazione su metà delle strade.
- **Modulo accorciato, mai saltato.** `shortestFitFactor` prova il modulo intero
  e poi 80/60/45/30/20%: si ferma alla prima lunghezza che resta entro 2 cm dal
  profilo. Su curve strette il pezzo si accorcia invece di tagliare la corda.
- **Giunti.** Passo = fine precedente − 2% della lunghezza corrente; il
  diagnostico conta buchi (> 5 cm) e sovrapposizioni (> 6%).
- **Quota.** Superficie = DEM + velo asfalto + 18 cm di cordolo + 3 cm; il
  modulo è posizionato con la faccia superiore sulla superficie.
- **Incroci.** Si campionano inizio, quarti, centro e fine: nessuna lastra
  attraversa una via laterale.

## Cosa resta da fare

- **Audit visivo** (`preview-paving.html`): non realizzato. Servirebbe un
  harness che carica i sette GLB su rettilineo, pendenze 5/10/15% lungo X, Z e
  diagonale e curva; i dati di targa sono già in questa tabella.
- **Decimazione** di `sidewalk-8m`, `sidewalk-long`, `curb-stone` con
  `gltf-transform simplify` (target 800–1.500 triangoli) per poterli usare
  oltre i 40 m o in alta qualità.
- **Metadati nel manifest** (`paving`, `topHeight`, `longAxis`, `tileable`,
  `uvRegion`): oggi le informazioni vivono qui e nel codice, non nel JSON.
- **Stile procedurale ↔ GLB**: il procedurale usa ancora un materiale unico
  (`footway_flags`/`granite_kerb`); per allineare l'aspetto al passaggio
  urbano ↔ extraurbano serve scegliere il materiale per via anche in
  `roads.ts` (oggi la transizione è solo geometrica, ai capi della catena).
- **UV continue**: i moduli ripetibili usano ancora l'UV del singolo pezzo;
  per lastre e cordoli serve UV in coordinate di mondo o per ascissa
  curvilinea, altrimenti la texture riparte a ogni giunto.
- **Gradini nei centri storici** (> 12%): opzione high+ non implementata.
