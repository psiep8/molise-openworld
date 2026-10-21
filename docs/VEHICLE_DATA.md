# Dati reali dei veicoli

I nove veicoli del gioco non sono più tarati "a occhio": ogni scheda in
`src/sim/vehicle-catalog.ts` descrive una **versione reale** e ne usa i dati di
fabbrica. Il modello fisico (`src/sim/car.ts`) li trasforma in accelerazione,
cambio, frenata e velocità di punta.

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

## Cosa il gioco ricava dai dati

Nessuna scheda tecnica pubblica il **CdA** o il **rapporto finale**, quindi il
codice li stima dai dati dichiarati:

- **Rapporto finale** — scelto perché l'ultima marcia arrivi al regime di
  potenza massima proprio alla velocità massima dichiarata.
- **CdA** — ricavato dall'equilibrio `potenza alle ruote = rotolamento + ½ρCdAv²`
  alla velocità di punta (con un margine del 6%, così la vettura tocca davvero
  il dato di targa e non si ferma 3 km/h prima).
- **Rapporti del cambio** — due set tipici (5 e 6 marce) per classe di vettura.
- **Aderenza e frenata** — `grip` 0,88–0,95 e decelerazione 8,8–10,2 m/s²,
  coerenti con pneumatici stradali su asfalto asciutto.

## Quanto è fedele la simulazione

Verificato da `tests/vehicle-dynamics.test.ts`:

- **velocità massima**: entro l'1% dal dato dichiarato, mai superiore;
- **0-100**: entro ±35% dal dato di fabbrica (il modello non riproduce tutte le
  perdite reali: gestione motore, slittamento frizione, asfalto, carico);
- **frenata** da 100 km/h: 30–55 m;
- cambio: parte in prima, sale fino all'ultima marcia, scala in decelerazione,
  non supera il limitatore;
- retromarcia inserita col freno da fermo e limitata alla velocità dichiarata.

Il tre ruote, per esempio, si ferma a 160 km/h come un trike turistico reale:
niente 200 all'ora.
