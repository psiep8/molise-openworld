# Dati reali dei veicoli

Il catalogo non è più tarato "a occhio": ogni scheda in
`src/sim/vehicle-catalog.ts` descrive una **versione reale** e ne usa i dati di
fabbrica. Il modello fisico (`src/sim/car.ts`) li trasforma in accelerazione,
cambio, frenata e velocità di punta.

Il catalogo ha **31 voci**: 21 con carrozzeria procedurale, 6 con modello GLB
(§ *Auto di serie su GLB*) e 4 carrozzerie low-poly del city kit. Le quattro
voci del kit non rappresentano un modello reale: la loro scheda è un
**riferimento di segmento**, non un dato di fabbrica.

## Schede

| id | Veicolo | Motore | Cilindrata | Potenza | Coppia | Massa | 0-100 | Velocità max | Marce |
|---|---|---|---|---|---|---|---|---|---|
| `panda-classic` | Fiat Panda (141) | 1.0 Fire 8V | 999 cm³ | 45 CV @ 5000 | 74 Nm @ 3250 | 780 kg | 16,2 s | 140 km/h | 5 |
| `panda-new` | Fiat Panda (319) | 1.2 Fire 8V | 1242 cm³ | 69 CV @ 5500 | 102 Nm @ 3000 | 1015 kg | 14,2 s | 164 km/h | 5 |
| `punto` | Fiat Grande Punto | 1.2 8V | 1242 cm³ | 65 CV @ 5500 | 102 Nm @ 3000 | 1020 kg | 14,5 s | 155 km/h | 5 |
| `renegade` | Jeep Renegade | 1.6 Multijet II | 1598 cm³ | 120 CV @ 3750 | 320 Nm @ 1750 | 1435 kg | 10,2 s | 178 km/h | 6 |
| `trike` | Trike Touring 1.9 | V-twin 114 ci | 1868 cm³ | 93 CV @ 5020 | 162 Nm @ 2500 | 570 kg | ~7,6 s | ~160 km/h | 6 |
| `500x` | Fiat 500X | 1.6 E-Torq | 1598 cm³ | 110 CV @ 5500 | 152 Nm @ 4500 | 1320 kg | 11,5 s | 180 km/h | 5 |
| `captur` | Renault Captur | 1.5 dCi 90 | 1461 cm³ | 90 CV @ 4000 | 220 Nm @ 1750 | 1245 kg | 13,1 s | 171 km/h | 5 |
| `c3` | Citroën C3 III | 1.2 PureTech 82 | 1199 cm³ | 82 CV @ 5750 | 118 Nm @ 2750 | 1050 kg | 14,2 s | 174 km/h | 5 |
| `junior` | Alfa Romeo Junior | 1.2 Hybrid 136 | 1199 cm³ | 136 CV @ 5500 | 230 Nm @ 1750 | 1385 kg | 8,9 s | 206 km/h | 6 |

## Auto di serie su GLB

Sei voci usano un modello in `public/cars/` (manifest versionato, binari fuori
da git). Le misure e i dati meccanici sono quelli della versione indicata; il
modello viene normalizzato e scalato sulla lunghezza, quindi la scheda resta la
fonte di verità anche se il GLB ha proporzioni leggermente diverse.

| id | Veicolo | Motore | Cilindrata | Potenza | Coppia | Massa | 0-100 | Velocità max | Marce |
|---|---|---|---|---|---|---|---|---|---|
| `punto` | Fiat Grande Punto | 1.2 8V | 1242 cm³ | 65 CV @ 5500 | 102 Nm @ 3000 | 1020 kg | 14,5 s | 155 km/h | 5 |
| `lamborghini-aventador` | Lamborghini Aventador | 6.5 V12 60° | 6498 cm³ | 700 CV @ 8250 | 690 Nm @ 5500 | 1575 kg | 2,9 s | 350 km/h | 7 |
| `ferrari-458` | Ferrari 458 Spider | 4.5 V8 90° | 4497 cm³ | 570 CV @ 9000 | 540 Nm @ 6000 | 1430 kg | 3,4 s | 320 km/h | 7 |
| `land-rover-defender` | Land Rover Defender | 3.0 I6 turbo MHEV | 2996 cm³ | 400 CV @ 6500 | 550 Nm @ 2000 | 2455 kg | 6,1 s | 191 km/h | 8 |
| `audi-r8` | Audi R8 V10 Performance | 5.2 V10 FSI | 5204 cm³ | 620 CV @ 8000 | 580 Nm @ 6400 | 1595 kg | 3,1 s | 331 km/h | 7 |
| `cupra-terramar` | Cupra Terramar | 2.0 TSI | 1984 cm³ | 265 CV @ 5500 | 400 Nm @ 1600 | 1740 kg | 5,9 s | 243 km/h | 7 |

Note:

- **Punto**: la voce esisteva già come procedurale; ora usa il GLB
  `fiat-punto.glb` senza cambiare fisica né scheda.
- **Aventador, Ferrari 458, Audi R8**: supercar con cambio a 7 rapporti e
  limitatore alto (8.500–9.000 giri). Il test globale alza il tetto a 360 km/h
  proprio per l'Aventador.
- **Defender**: unico a 8 marce nel catalogo; `offroadFactor: 1` significa che
  non perde velocità fuori dall'asfalto.
- **Cupra Terramar**: `yaw: 90` nel manifest perché il modello esportato ha il
  muso ruotato di 90° rispetto a +Z.
- **Licenza**: i GLB sono forniti dal proprietario e restano fuori da git; la
  licenza va verificata prima di una distribuzione pubblica.

## Fonti

- **Panda 141 1.0 Fire 45 CV** — 140 km/h e 0-100 in 16,2 s:
  [autodata24](https://it.autodata24.com/fiat/panda/panda-141a/1000-fire-l-45-hp/details),
  coppia 74 Nm @ 3250 (stessa scheda).
- **Panda 319 1.2 69 CV** — 164 km/h, 0-100 in 14,2 s, 102 Nm:
  [auto-data.net](https://www.auto-data.net/it/fiat-panda-iii-319-1.2-69hp-36562),
  [Autoscout24](https://www.autoscout24.it/auto/dati-tecnici/fiat/panda/panda-1-2-easy-s-and-s-69cv-my19-city-car-benzina-senza-piombo-8771/).
- **Grande Punto 1.2 65 CV** — 155 km/h, 0-100 in 14,5 s:
  [auto-data.net](https://www.auto-data.net/it/fiat-grande-punto-199-1.2-65hp-17021).
- **Renegade 1.6 Multijet 120 CV** — 178 km/h, 0-100 in 10,2 s:
  [AlVolante](https://www.alvolante.it/primo_contatto/jeep-renegade-2018-16-multijet),
  coppia 320 Nm @ 1750 (scheda Stellantis/zeperfs).
- **Trike Touring 1.9** (classe Harley-Davidson Tri Glide Ultra, 114 ci) — 93 CV
  @ 5020 giri, 162 Nm @ 2500:
  [Cycle World](https://www.cycleworld.com/harley-davidson/2024-tri-glide-ultra/),
  [scheda H-D](https://www.wickedwesthd.com/showroom/harley-davidson/2024/family/trike/model/tri-glide-ultra).
  Velocità di punta ~160 km/h e 0-100 ~7,6 s: dato di categoria, non dichiarato
  dalla casa.
- **500X 1.6 E-Torq 110 CV** — 180 km/h, 0-100 in 11,5 s:
  [Automoto.it](https://www.automoto.it/catalogo/fiat/500x/16-e-torq-110-cv-pop-star-my-17/121158),
  [AlVolante](https://www.alvolante.it/fuori-listino/fiat-500x-serie-1-restyle-2014-2023/1.6-e-torq-110-cv-120th-121579).
- **Captur 1.5 dCi 90** — 171 km/h, 0-100 in 13,1 s, 220 Nm:
  [Autoscout24](https://www.autoscout24.it/auto/dati-tecnici/renault/captur/captur-1-5-dci-intens-energy-r-link-90cv-e6-suv-fuoristrada-pick-up-diesel-3409/),
  [Patentati](https://www.patentati.it/prove/renault-captur-dci-90cv-prova-su-strada.html).
- **Citroën C3 1.2 PureTech 82** — 174 km/h, 0-100 in 14,2 s, 118 Nm:
  [Quattroruote](https://www.quattroruote.it/auto/citroen/c3-2-serie/c3-puretech-82-exclusive-105000201410).
- **Alfa Romeo Junior 1.2 Hybrid 136** — 206 km/h, 0-100 in 8,9 s, 230 Nm:
  [AlVolante](https://www.alvolante.it/primo_contatto/alfa-romeo-junior-12-hybrid-136-cv),
  [Motorbox](https://www.motorbox.com/auto/auto-viste-e-provate/auto-day-by-day/alfa-romeo-junior-12-hybrid-prova-design-prestazioni-e-prezzi).
- **Auto di serie su GLB** — Aventador, 458 Spider, Defender, R8 V10 Performance
  e Terramar usano le **schede di fabbrica delle versioni indicate** (potenza,
  coppia, massa, 0-100 e velocità massima). Non si citano URL perché le pagine
  dei costruttori cambiano spesso: se serve una verifica puntuale, la fonte è il
  comunicato tecnico della versione, non un sito di terze parti. La Punto
  mantiene la scheda della Grande Punto 1.2 8V già documentata sopra.

## Cosa il gioco ricava dai dati

Nessuna scheda tecnica pubblica il **CdA** o il **rapporto finale**, quindi il
codice li stima dai dati dichiarati:

- **Rapporto finale** — scelto perché l'ultima marcia arrivi al regime di
  potenza massima proprio alla velocità massima dichiarata.
- **CdA** — ricavato dall'equilibrio `potenza alle ruote = rotolamento + ½ρCdAv²`
  alla velocità di punta (con un margine del 6%, così la vettura tocca davvero
  il dato di targa e non si ferma 3 km/h prima).
- **Rapporti del cambio** — set tipici per 5, 6, 7 e 8 marce
  (`FIVE_SPEED`, `SIX_SPEED`, `SEVEN_SPEED`, `EIGHT_SPEED`). Le supercar usano
  7 rapporti con limitatore a 8.500–9.000 giri; il Defender è l'unico a 8.
- **Aderenza e frenata** — `grip` 0,88–1,3 e decelerazione 8,8–11,8 m/s²,
  coerenti con pneumatici stradali su asfalto asciutto (i valori alti sono delle
  supercar, non delle utilitarie).
- **Suono del motore** — `engineVoice()` legge cilindri (`V12`, `V8`, `W12`,
  `I6`, `V-twin`), `idleRpm`, `redlineRpm` e cilindrata. La frequenza di
  accensione è quella fisica, `rpm/60 × cilindri/2`: il V12 dell'Aventador
  ronfa a ~85 Hz al minimo, il 1.2 del Punto a ~27 Hz. Attenzione a non
  scambiare le valvole per cilindri: `1.2 Fire 8V` è un quattro cilindri.

## Quanto è fedele la simulazione

Verificato da `tests/vehicle-dynamics.test.ts` su **tutte le 31 voci** del
catalogo (le auto importate dall'utente hanno una scheda stimata e non entrano
in questo test); `tests/engine-voice.test.ts` copre la voce del motore:

- **velocità massima**: entro l'1% dal dato dichiarato, mai superiore, e
  comunque mai oltre **360 km/h** (tetto globale, serve all'Aventador);
- **0-100**: entro ±35% dal dato di fabbrica (il modello non riproduce tutte le
  perdite reali: gestione motore, slittamento frizione, asfalto, carico);
- **frenata** da 100 km/h: 30–55 m;
- cambio: parte in prima, sale fino all'ultima marcia (5, 6, 7 o 8), scala in
  decelerazione, non supera il limitatore;
- retromarcia inserita col freno da fermo e limitata alla velocità dichiarata.

Il tre ruote, per esempio, si ferma a 160 km/h come un trike turistico reale:
niente 200 all'ora.
