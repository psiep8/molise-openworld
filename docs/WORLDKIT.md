# World kit — vegetazione, campagna e arredo

I GLB consegnati dal proprietario per "completare il mondo" (erba, alberi,
sassi, cartelli, una casa di campagna) **sono versionati nel repository** in
`public/worldkit/`. Non c'è nessuno script da lanciare su una macchina nuova:
un clone, un `git pull` e una build di produzione li contengono già, e il gioco
li carica all'avvio.

Questo li distingue dal *city kit* (`public/citykit/`, licenza Free Commercial,
non ridistribuibile → `npm run kit`) e dalle auto (`public/cars/*.glb`, fuori da
git): quelli restano asset locali, il world kit è parte del progetto.

## Cosa c'è dentro

| Ruolo | Modelli | A cosa serve |
| --- | --- | --- |
| `tree` | 2 | alberi realistici ad alto dettaglio, dove il giocatore passa vicino |
| `shrub` | 76 | sottobosco: felci, origano, camomilla, bambù, piante da 0,3–1,3 m |
| `tree-distant` | 20 | sagome low-poly per riempire l'orizzonte a centinaia di metri |
| `grass` | 9 | ciuffi d'erba fotografati nel raggio di 34 m dal giocatore |
| `rock` | 9 | sassi e affioramenti sui pendii |
| `sign` | 5 | cartelli stradali su palo lungo le provinciali, con collisione |
| `house` | 1 | casale di campagna con impronta solida nell'indice collisioni |
| `spare` | 26 | terreni, cordoli, marciapiedi, guardrail, lampioni, chiesa, neve… |

Il pack di vegetazione è tutto **sottobosco** (0,2–1,3 m), non alberi: va piazzato
alla sua scala, altrimenti diventa una liana alta dieci metri. Per questo il
ruolo si chiama `shrub` e non `tree`.

I `spare` sono nel repo e nel manifest ma **non vengono caricati**: sono riserve
per i prossimi lavori (marciapiedi fotografati, guardrail a modello, lampioni,
zolle d'erba ad alta densità). Non pesano sulla VRAM né sul tempo di avvio.
La coda completa delle 26 riserve, con licenze e blocchi tecnici, è in
[`docs/RESERVE-TODO.md`](RESERVE-TODO.md).

I ruoli e le regole di piazzamento stanno in `src/world/world-props.ts`; il
caricamento in `src/world/worldkit.ts`.

## Piazzamento

- Deterministico: seed fissi per categoria (`mulberry32`), nessun
  `Math.random()`. Lo stesso mondo a ogni avvio.
- Rispetta strade, marciapiedi, piazze, edifici e pendenze; le **case** entrano
  nell'indice delle collisioni prima che vegetazione ed erba vengano costruite.
- Budget per preset (`worldPropBudget`): da zero su *compatibilità* a 58 alberi
  veri + 760 piante di sottobosco + 1.400 sagome lontane + 120 sassi + 12 cartelli
  + 6 casali su *ultra*.
- L'erba fotografata (`WorldGrass`) segue il giocatore e si ricostruisce ogni
  12 m, con al massimo 400 ciuffi: è un dettaglio da primo piano, non un tappeto.
- I cartelli aggiungono un ostacolo cilindrico; i casali un'impronta rettangolare.

I budget non cambiano a runtime quando si preme `G`: come per casali e arredo
del city kit, il world kit viene costruito una volta all'avvio con il preset
attivo.

## Meteo, guida e urti

Il kit non è un diorama: è collegato agli stessi sistemi del resto del mondo.

- **Vento** — alberi, sottobosco, erba e cartelli usano lo stesso uniform
  `uWind` di chiome ed erba procedurali, alimentato da velocità e direzione del
  meteo reale (`setWind`). La base resta ferma, la punta si piega; i cartelli
  quasi no, perché un palo zincato non è una foglia.
- **Pioggia** — tutti i materiali importati hanno `uKitWet`: scuriscono a 0,62 e
  portano la rugosità a 0,22, sulla stessa scala di `applyWetness` dell'asfalto.
  Quando piove, il mondo importato è bagnato come la strada.
- **Neve** — `uKitSnow` (da `snowPack`) imbianca solo le superfici che guardano
  in alto: chiome, sassi e tetti si coprono, tronchi e pali restano scuri, e la
  rugosità sale a 0,92 (la neve non è lucida). La trazione resta quella di
  `surfaceGripScale`.
- **A piedi** — attraversare il sottobosco costa velocità: `WorldShrubField`
  risponde 0,55 dentro una macchia (`ScatterVegetation.movementFactorAt` fa il
  resto per gli alberi procedurali).
- **Collisioni** — i tronchi dei due alberi veri sono ostacoli cilindrici
  (`world-tree`), le sagome lontane hanno un tronco più stretto
  (`world-tree-far`), i sassi sono solidi (`world-rock`), i cartelli hanno il palo
  (`sign`) e i casali un'impronta rettangolare più un ostacolo (`world-house`).
  Auto e pedone leggono lo stesso `ObstacleIndex`: non si attraversa niente.
- **Urti** — alberi e cartelli hanno, per istanza, l'attributo `aHit`
  (inizio, forza, dx, dz). `WorldHitField` scrive solo l'istanza colpita e lo
  shader la fa piegare e tornare a posto in circa un secondo; nessuna matrice da
  riscrivere a ogni frame. La carrozzeria accusa il colpo con lo stesso `bump`
  del cordolo e il **suono** cambia col materiale: metallico sui cartelli, sordo
  su tronchi e muri (`audio.impact`). Sassi e case sono rigidi: restano ostacoli
  e basta.
- **Niente sopra l'asfalto** — ogni piazzamento passa da `free()`: strade,
  marciapiedi, piazze, edifici e piazzali restano liberi, quindi il mondo è
  guidabile e non ci sono alberi in mezzo alla carreggiata.
- **Diagnostica** — `window.__molise.world` riporta modelli, triangoli, oggetti
  piazzati e `hitCount` (urti fatti reagire); ogni materiale del kit espone
  `userData.kitWet` e `userData.kitSnow`, così dal browser si legge il valore
  vero di pioggia e neve arrivato ai modelli.

## Come sono prodotti i GLB

Gli originali sono scan Sketchfab: fino a 2 milioni di triangoli, texture 4K,
materiali `KHR_materials_pbrSpecularGlossiness` che three.js non legge più.
`scripts/import-world-glb.mjs` li trasforma:

1. isola il nodo (o l'intera scena) e scarta materiali/texture non usati;
2. converte spec-gloss in metal-rough e toglie `KHR_materials_unlit`;
3. unisce le primitive per materiale, salda i vertici e semplifica al budget;
4. riduce le texture a 512–1024 px in WebP e comprime la geometria con
   `EXT_meshopt_compression` + `KHR_mesh_quantization` (decoder incluso in three,
   nessuna cartella `public/draco/` da scaricare);
5. scrive il GLB, aggiorna `manifest.json` e `ATTRIBUTION.md`.

Il risultato passa da ~1 GB a ~60 MB, con un file massimo sotto i 15 MB (GitHub
rifiuta i file oltre 100 MB).

### Rigenerare

Servono gli originali: estrai lo zip in `incoming-glb/` (ignorata da git).

```bash
npm run worldkit                 # rigenera tutto
npm run worldkit -- --file=grass # un solo file sorgente
npm run worldkit -- --only=tree  # solo gli slug che contengono "tree"
npm run worldkit -- --check      # verifica manifest e file senza scrivere
```

Il manifest è la fonte di verità per il runtime: slug, ruolo, file, nodi,
altezza reale (m), ingombri, triangoli, byte, uso (`placed`/`reserve`) e crediti.

## Licenze

Tutti i modelli sono di terzi (Sketchfab). I file con licenza **Sketchfab
Standard** non sono ridistribuibili e **non sono nel repository**: lo script li
salta (`grass (2)`, `realistics_grass_10`, `dry_realistic_grass_lods_1`).
Gli altri sono CC BY 4.0, CC BY-SA 4.0 o CC BY-NC 4.0.

> **Attenzione alla CC BY-NC**: *Via S. Gemini (Viterbo)* è **non commerciale**.
> Finché il progetto resta gratuito va bene; per un uso commerciale va sostituita
> o rimossa (nel manifest ha `usage: reserve`, quindi non è nel mondo).

Crediti completi e per-modello: [`public/worldkit/ATTRIBUTION.md`](../public/worldkit/ATTRIBUTION.md),
generato dai metadati `asset.extras` dei GLB originali. La tabella è anche in
`ATTRIBUTION.md` nella radice.

## Test

`tests/worldkit.test.ts` controlla che ogni modello del manifest esista, che i
byte dichiarati coincidano, che i ruoli siano noti, che le licenze permettano la
ridistribuzione e che il totale resti sotto il budget di repository.
`tests/world-props.test.ts` controlla che i budget crescano con il preset, che
`minimal` sia davvero spento e che i cartelli ruotino la faccia contro il senso
di marcia (la faccia leggibile è sul lato `-X` locale). `tests/world-hits.test.ts`
verifica che un urto colpisca l'istanza giusta, nel verso giusto e con la forza
giusta; `tests/obstacles.test.ts` che si sappia **quale** ostacolo è stato preso.
