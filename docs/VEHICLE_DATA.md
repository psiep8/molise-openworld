# Dati reali dei veicoli

Il catalogo non è tarato "a occhio": ogni scheda in
`src/sim/vehicle-catalog.ts` descrive una **versione reale** e ne usa i dati di
fabbrica. Il modello fisico (`src/sim/car.ts`) li trasforma in accelerazione,
cambio, frenata e velocità di punta.

Il catalogo ha **30 voci, tutte con un GLB** dell'archivio `cars.zip` fornito
dal proprietario. I binari restano fuori da git (`public/cars/*.glb`); il
manifest versionato `public/cars/manifest.json` dice per ogni voce file, yaw e
lunghezza misurata, mentre **crediti e licenze** stanno in
`src/sim/vehicle-credits.ts` e in [ATTRIBUTION.md](../ATTRIBUTION.md).

## Schede

Legenda: `†` = modello presente nell'archivio ma **fuori dalla lista di 25
crediti** fornita; `*` = concept o ricostruzione storica, con dati stimati.
Le elettriche non hanno cilindrata e usano una sola marcia; `Nm @ 1` significa
coppia disponibile da fermo (curva da motore elettrico).

| id | Veicolo | Motore | Cil. cm³ | Potenza | Coppia | Massa | 0-100 | Vmax | Marce | Trazione |
|---|---|---|---|---|---|---|---|---|---|---|
| `audi-r8-2010` | Audi R8 5.2 FSI Quattro (2010) | 5.2 V10 FSI | 5204 | 525 CV @ 8000 | 530 Nm @ 6500 | 1620 kg | 3,9 s | 316 km/h | 6 | AWD |
| `fiat-punto-2011` | Fiat Punto (2011) | 1.2 8V | 1242 | 65 CV @ 5500 | 102 Nm @ 3000 | 1020 kg | 14,5 s | 155 km/h | 5 | FWD |
| `bmw-m4-competition-2021` | BMW M4 Competition (2021) | 3.0 I6 biturbo | 2993 | 510 CV @ 6250 | 650 Nm @ 2750 | 1725 kg | 3,9 s | 290 km/h | 8 | RWD |
| `yamaha-mt09-sp-2025` | Yamaha MT-09 SP (2025) | 890 CP3 I3 | 890 | 119 CV @ 10000 | 93 Nm @ 7000 | 193 kg | 3,3 s | 215 km/h | 6 | RWD |
| `audi-novulari` | Audi Novulari (concept) * | 4.0 V8 biturbo ibrido | 3996 | 800 CV @ 7000 | 800 Nm @ 3000 | 1600 kg | 2,9 s | 330 km/h | 7 | AWD |
| `audi-r8-2023` | Audi R8 Coupé Performance quattro (2023) | 5.2 V10 FSI | 5204 | 620 CV @ 8000 | 580 Nm @ 6400 | 1595 kg | 3,1 s | 331 km/h | 7 | AWD |
| `bmw-1930s-saloon` | BMW 326 inspired (1930s) * | 2.0 I6 | 1971 | 50 CV @ 3750 | 130 Nm @ 2000 | 1120 kg | 30 s | 115 km/h | 4 | RWD |
| `bmw-m3-sedan` | BMW M3 Sedan (E46) | 3.2 I6 | 3246 | 343 CV @ 7900 | 365 Nm @ 4900 | 1495 kg | 5,2 s | 250 km/h | 6 | RWD |
| `cupra-terramar` | Cupra Terramar | 2.0 TSI | 1984 | 265 CV @ 5500 | 400 Nm @ 1600 | 1740 kg | 5,9 s | 243 km/h | 7 | AWD |
| `detomaso-p900` | DeTomaso P900 | 6.2 V12 | 6200 | 900 CV @ 8500 | 750 Nm @ 5000 | 900 kg | 2,5 s | 350 km/h | 7 | RWD |
| `ferrari-f1-2019` | Ferrari F1 2019 | 1.6 V6 turbo ibrido | 1600 | 1000 CV @ 12000 | 585 Nm @ 6000 | 743 kg | 2,5 s | 340 km/h | 8 | RWD |
| `ferrari-laferrari` | Ferrari LaFerrari | 6.3 V12 ibrido | 6262 | 963 CV @ 9250 | 900 Nm @ 6750 | 1585 kg | 2,6 s | 350 km/h | 7 | RWD |
| `fiat-500` | Fiat 500 (2007) | 1.2 8V | 1242 | 69 CV @ 5500 | 102 Nm @ 3000 | 940 kg | 12,9 s | 160 km/h | 5 | FWD |
| `fiat-500-1970` | Fiat 500 (1970) | 0.5 I2 | 499 | 18 CV @ 4600 | 30 Nm @ 3000 | 500 kg | n.d. | 95 km/h | 4 | RWD |
| `fiat-500-abarth` | Fiat 500 Abarth | 1.4 T-Jet | 1368 | 135 CV @ 5500 | 180 Nm @ 2500 | 1035 kg | 7,9 s | 205 km/h | 5 | FWD |
| `fiat-multipla-1998` | Fiat Multipla (1998) | 1.6 16V | 1581 | 103 CV @ 5750 | 145 Nm @ 4000 | 1300 kg | 12,5 s | 170 km/h | 5 | FWD |
| `fiat-uno-1994` | Fiat Uno (1994) | 1.0 Fire | 999 | 45 CV @ 5000 | 74 Nm @ 3250 | 800 kg | 16,2 s | 140 km/h | 5 | FWD |
| `fiat-punto-gt-1995` | Fiat Punto GT (1995) | 1.4 turbo | 1372 | 133 CV @ 6000 | 204 Nm @ 3000 | 980 kg | 8,4 s | 200 km/h | 5 | FWD |
| `lamborghini-revuelto` | Lamborghini Revuelto | 6.5 V12 ibrido | 6498 | 1015 CV @ 9250 | 725 Nm @ 6750 | 1772 kg | 2,5 s | 350 km/h | 8 | AWD |
| `land-rover-defender` | Land Rover Defender 110 P400 | 3.0 I6 turbo MHEV | 2996 | 400 CV @ 6500 | 550 Nm @ 2000 | 2455 kg | 6,1 s | 191 km/h | 8 | AWD |
| `mg-cyberster-2025` | MG Cyberster (2025) | EV dual motor | 0 | 503 CV @ 8000 | 725 Nm @ 1 | 1985 kg | 3,2 s | 200 km/h | 1 | AWD |
| `porsche-911-mistery` | Porsche 911 Carrera (992) | 3.0 flat-6 biturbo | 2981 | 394 CV @ 6500 | 450 Nm @ 1950 | 1585 kg | 4,2 s | 294 km/h | 8 | RWD |
| `seat-leon-cupra-race` | SEAT León Cupra Race Car | 2.0 TSI TCR | 1984 | 300 CV @ 6300 | 410 Nm @ 2500 | 1100 kg | 5,2 s | 250 km/h | 6 | FWD |
| `tesla-cybertruck` | Tesla Cybertruck | EV tri-motor | 0 | 845 CV @ 6000 | 1000 Nm @ 1 | 3104 kg | 2,7 s | 209 km/h | 1 | AWD |
| `vespa-scooter` | Vespa Scooter | 125 i-get | 124 | 10,7 CV @ 7700 | 10,4 Nm @ 6000 | 110 kg | n.d. | 95 km/h | 1 | RWD |
| `aston-martin-db11` | Aston Martin DB11 † | 5.2 V12 biturbo | 5204 | 608 CV @ 6500 | 700 Nm @ 1500 | 1770 kg | 3,9 s | 322 km/h | 8 | RWD |
| `fiat-panda-4x4` | Fiat Panda 4x4 † | 1.3 Multijet | 1248 | 75 CV @ 4000 | 190 Nm @ 1500 | 1190 kg | 16 s | 150 km/h | 5 | AWD |
| `honda-civic-rs` | Honda Civic RS † | 1.5 VTEC Turbo | 1498 | 182 CV @ 6000 | 240 Nm @ 1700 | 1300 kg | 8 s | 220 km/h | 6 | FWD |
| `volkswagen-crafter` | Volkswagen Crafter † | 2.0 TDI | 1968 | 177 CV @ 3600 | 410 Nm @ 1500 | 2400 kg | 12 s | 160 km/h | 8 | FWD |
| `volkswagen-golf-gti-2025` | Volkswagen Golf GTI (2025) † | 2.0 TSI | 1984 | 265 CV @ 5000 | 370 Nm @ 1600 | 1465 kg | 5,9 s | 250 km/h | 7 | FWD |

`n.d.` = non dichiarato perché la velocità massima (95 km/h) non permette di
toccare i 100 km/h. Il test verifica che Fiat 500 1970 e Vespa arrivino alla
loro punta, senza pretendere uno 0-100 impossibile.

## Moto e pilota

Yamaha MT-09 SP e Vespa sono le uniche due ruote del catalogo. Hanno:

- **pilota visibile**: il corpo del giocatore (`HumanBody`) viene clonato
  sullo scheletro condiviso e posato seduto da `Vehicle.buildRider` (cosce in
  avanti, ginocchia piegate, mani verso il manubrio). A piedi il pilota sparisce
  dal veicolo parcheggiato;
- **piega in curva**: `bodyLean` riceve `leanFactor` negativo e `maxLean` più
  alto; l'auto rolla verso l'esterno, la moto verso l'interno;
- **ruote riconosciute per nome**: `wheel_lf`/`wheel_lr` sulla Yamaha,
  `front_weel`/`back_weel` sulla Vespa. Il caricatore accetta anche
  `front_wheel`/`rear_wheel`.

## Dati derivati

Nessuna scheda tecnica pubblica il **CdA**, il **rapporto finale** o la
ripartizione di aderenza. Il codice li stima dai dati dichiarati:

- **Rapporto finale** – scelto perché l'ultima marcia arrivi al regime di
  potenza massima proprio alla velocità massima dichiarata. Per le elettriche
  (una sola marcia) si usa il **regime massimo**, non il regime di potenza:
  altrimenti la Cybertruck avrebbe un finale cortissimo e uno 0-100 da furgone.
- **CdA** – ricavato dall'equilibrio *potenza alle ruote = rotolamento +
  ½ρCdAv²* alla velocità di punta, con un margine del 6%.
- **Rapporti del cambio** – la Yamaha usa i rapporti reali `MT09_SPEED`; le
  altre voci usano set tipici a 4, 5, 6, 7 o 8 marce. Le elettriche hanno una
  sola marcia.
- **Aderenza** – `grip` 0,9–1,6 e ripartizione di trazione 0,62 (FWD), 0,85
  (RWD) e 1,0 (AWD). La ripartizione RWD tiene conto del trasferimento di carico
  in partenza, non della sola metà statica.
- **Cambio automatico** – sale vicino al regime di potenza massima, non al
  limitatore, così usa davvero l'ultima marcia; il kickdown ha una soglia più
  bassa per non far oscillare le utilitarie fra prima e seconda.
- **Frenata** – `brakeDecel` da 8,8 a 18 m/s²; le sportive e la F1 stanno sotto
  i 30 m da 100 km/h, le auto normali sui 40 m.

## Quanto è fedele la simulazione

Verificato da `tests/vehicle-dynamics.test.ts` su **tutte le 30 voci**;
`tests/engine-voice.test.ts` copre la voce del motore e `tests/driving.test.ts`
la guida credibile.

- **velocità massima**: entro il 3% dal dato dichiarato, mai superiore, e
  comunque mai oltre **360 km/h**;
- **0-100**: entro ±35% dal dato di fabbrica (il modello non riproduce tutte le
  perdite reali: gestione motore, slittamento frizione, asfalto, carico);
- **frenata** da 100 km/h: 18–55 m, con le auto stradali nella parte alta e le
  sportive in quella bassa;
- cambio: parte in prima, sale fino all'ultima marcia, scala in decelerazione,
  non supera il limitatore;
- retromarcia inserita col freno da fermo e limitata alla velocità dichiarata.

## Fonti e licenze

- **Prestazioni**: schede tecniche delle versioni indicate (potenza, coppia,
  massa, 0-100 e velocità massima). Per i concept e la ricostruzione anni '30 i
  valori sono stime dichiarate nella tabella con `*`.
- **Modelli 3D**: autori, titoli, URL Sketchfab e licenze sono in
  [ATTRIBUTION.md](../ATTRIBUTION.md). I cinque modelli `†` non erano nella
  lista di 25 crediti e quattro di essi usano **Sketchfab Standard**, quindi
  non sono ridistribuibili.
- **File GLB**: non versionati; il manifest è versionato. Per ripristinarli su
  un altro PC vedi [docs/GARAGE.md](GARAGE.md).
