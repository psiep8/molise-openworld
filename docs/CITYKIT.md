# City kit (threejsassets.com) — acquisizione e uso

Documento operativo per gli asset 3D esterni. Regola di fondo: **il mondo resta
quello vero di Palata** (OSM + DEM); il kit serve a rendere credibili strade,
marciapiedi, vegetazione, arredo urbano e veicoli, non a sostituire la geografia.

---

## 1. Cosa prendiamo e perché

Il catalogo del sito è stato censito per intero (2.288 asset, 937 nel tier free).
Quasi tutti sono **low-poly stilizzati** (City, Cozy Village, Metropolis, Vice
Beach…): dentro un paese molisano fotorealistico si notano subito e farebbero
peggio delle mesh procedurali. L'unico pack in **scala reale e PBR** è
**Realistic City**, e il suo tier free contiene proprio i pezzi che oggi sono
più deboli.

| Ruolo nel motore | Asset | Note |
| --- | --- | --- |
| `road-surface` | Realistic Road Straight 01 | asfalto 12 m, materiali per i nastri OSM |
| `road-junction` | Realistic Road Intersection 01 | usura e patch nelle zone di incrocio |
| `sidewalk` | Realistic Sidewalk 01 | 3 × 12 m, cordolo in granito, lastre con giunti |
| `plaza` | Realistic Plaza Paving 01 | pavimentazione della piazza di Palata |
| `tree-street` | Realistic Street Tree 01 | chioma volumetrica |
| `tree-park` | Realistic Park Tree 01 | alberi da parco e bosco |
| `lamp` | Realistic Street Lamp 01 | lampione stradale |
| `traffic-light` | Realistic Traffic Light 01 | semaforo |
| `sign` | Realistic Street Sign 01 | segnaletica verticale |
| `bench` | Realistic Bench 01 | panchina |
| `bin` | Realistic Trash Bin 01 | cestino |
| `car` | Realistic Car Sedan 01 | auto parcheggiate e traffico |
| `boulder` | Realistic Rock Boulder 01 | massi per scarpate e muretti a secco |

**Non** prendiamo (free ma incoerenti con il posto): brownstone, office tower,
canal tile, subway entrance, sky dome. A Palata non esistono e il cielo attuale
è già fisico.

Gli altri campi free del sito (nature, arredo, veicoli dei pack stilizzati) sono
low-poly: non li usiamo per non abbassare la resa.

---

## 2. Licenza — regole da non violare

- Licenza: **Free Commercial License** di threejsassets.com
  (<https://threejsassets.com/license#free-asset-license>). Uso in prodotti,
  anche commerciali, **senza obbligo di attribuzione**; modifica e combinazione
  consentite.
- **Vietato ridistribuire i file**, anche modificati: niente mirror, asset pack,
  dataset, repo pubblici, download condivisi.
  Per questo `public/citykit/` è in `.gitignore` e i GLB **non** entrano nel
  repository, esattamente come le texture CC0 da 28 MB.
- La chiave API è personale: non va committata né condivisa. `.env.local` è già
  ignorato da git.
- Senza kit il gioco resta completo: tutto il codice ha un fallback procedurale.

---

## 3. Creare la chiave e scaricare

1. Crea un account gratuito su <https://threejsassets.com>.
2. **Account → Connections → API key**: crea una chiave con scope
   `catalog:read` + `downloads:read`.
3. Scrivi la chiave in `.env.local` (file ignorato da git):

   ```
   THREEJSASSETS_KEY=tja_live_xxxxxxxxxxxxxxxx
   ```

4. Scarica:

   ```bash
   npm run kit -- --list   # cosa è free nel pack (nessuna chiave)
   npm run kit             # scarica i 13 asset + manifest + decodificatore Draco
   ```

   Non vuoi usare una chiave? Scarica a mano i 13 file free dal sito (pulsante
   **Download** su ogni asset, il file si chiama `<slug>.glb`), mettili in
   `public/citykit/` e indicizzali:

   ```bash
   npm run kit -- --index
   ```

Lo script è idempotente: salta i file già presenti e corretti, riscarica con
`--force`, e accetta `--only=slug,slug`. Una richiesta alla volta, come chiede
la documentazione delle API (budget più stretto per i download).

### Lista per il download manuale

Tutti nel tier **free** del pack. Salvali in `public/citykit/` con il nome
`<slug>.glb` (è il nome con cui il sito li scarica), in una cartella piatta.

| # | Ruolo | Asset | Slug / file | Byte |
| --- | --- | --- | --- | --- |
| 1 | strada | Realistic Road Straight 01 | [`realistic-road-straight-01`](https://threejsassets.com/assets/realistic-road-straight-01) | 1,050,660 |
| 2 | incrocio | Realistic Road Intersection 01 | [`realistic-road-intersection-01`](https://threejsassets.com/assets/realistic-road-intersection-01) | 1,166,864 |
| 3 | marciapiede | Realistic Sidewalk 01 | [`realistic-sidewalk-01`](https://threejsassets.com/assets/realistic-sidewalk-01) | 593,868 |
| 4 | piazza | Realistic Plaza Paving 01 | [`realistic-plaza-paving-01`](https://threejsassets.com/assets/realistic-plaza-paving-01) | 4,036,796 |
| 5 | albero strada | Realistic Street Tree 01 | [`realistic-street-tree-01`](https://threejsassets.com/assets/realistic-street-tree-01) | 1,078,972 |
| 6 | albero parco | Realistic Park Tree 01 | [`realistic-park-tree-01`](https://threejsassets.com/assets/realistic-park-tree-01) | 955,140 |
| 7 | lampione | Realistic Street Lamp 01 | [`realistic-street-lamp-01`](https://threejsassets.com/assets/realistic-street-lamp-01) | 174,040 |
| 8 | semaforo | Realistic Traffic Light 01 | [`realistic-traffic-light-01`](https://threejsassets.com/assets/realistic-traffic-light-01) | 178,648 |
| 9 | segnale | Realistic Street Sign 01 | [`realistic-street-sign-01`](https://threejsassets.com/assets/realistic-street-sign-01) | 531,588 |
| 10 | panchina | Realistic Bench 01 | [`realistic-bench-01`](https://threejsassets.com/assets/realistic-bench-01) | 881,444 |
| 11 | cestino | Realistic Trash Bin 01 | [`realistic-trash-bin-01`](https://threejsassets.com/assets/realistic-trash-bin-01) | 1,120,692 |
| 12 | auto | Realistic Car Sedan 01 | [`realistic-car-sedan-01`](https://threejsassets.com/assets/realistic-car-sedan-01) | 718,416 |
| 13 | masso | Realistic Rock Boulder 01 | [`realistic-rock-boulder-01`](https://threejsassets.com/assets/realistic-rock-boulder-01) | 509,252 |

Totale **12,4 MB**. `--index` controlla che ogni file esista e sia un GLB, e
avvisa se manca o ha un nome diverso.

Output:

```
public/citykit/
  manifest.json        # ruolo, categoria, triangoli, byte, sha256, licenza
  NOTICE.md            # provenienza + tabella asset
  realistic-*.glb      # 13 modelli
public/draco/          # decodificatore Draco copiato da node_modules/three
```

Il manifest è il contratto col motore: il codice cerca i **ruoli**, non i nomi
dei file.

---

## 4. Come il motore li usa (integrazione)

Attenzione a un dettaglio che il sito non dichiara per questo pack: i GLB hanno
il **pivot al centro del bounding box**, non a terra. `src/world/citykit.ts` li
normalizza al caricamento (base a y = 0, centro in x/z) e cuoce la trasformazione
nella geometria, così le istanze hanno solo posizione e rotazione.

- **Strade e marciapiedi** (`src/world/roads.ts`): le tile non si incollano alle
  curve OSM. Si prendono i materiali PBR (`asphalt_slab`, `footway_flags`,
  `granite_kerb`) e si applicano ai nastri drappeggiati: UV in metri, repeat
  0,55 × 0,5 (asfalto 12 m, lastre 3 × 12 m) e vertex color bianco per non
  scurire due volte. Marciapiede e cordolo sono ora due mesh/materiali separati.
  La bagnatura del meteo resta attiva (`userData.roadWet`) con uno shader
  dedicato al materiale del kit.
- **Panchine e cestini** (`src/world/street-furniture.ts`): le panchine del kit
  sostituiscono quelle a scatole, i cestini compaiono ogni tre panchine. Tetti
  per preset (6/12/24/32 panchine) perché ognuna è 21k triangoli.
- **Alberi di strada e auto in sosta** (`src/world/city-props.ts`): alberi ogni
  ~26 m sul marciapiede dentro il paese, auto ogni ~28 m sulla fascia di sosta,
  nel senso di marcia, solo su strade larghe; tetti 0/10/22/32 alberi e
  4/10/18/24 auto secondo il preset. Tutto deterministico e limitato a Palata.
- **Non piazzati di proposito**: semaforo, segnale, lampione, masso, piazza,
  incrocio. Sono scaricati e pronti, ma un semaforo in un paese senza semafori
  o un lampione urbano da 8 m al posto delle lanterne da 6,2 m romperebbe la
  coerenza. Si attivano quando c'è un posto vero che li giustifica.

Tutto è additivo: se `public/citykit/manifest.json` manca (macchina nuova,
licenza non accettata, rete assente) il motore usa le mesh procedurali e non
cambia nulla. Diagnostica: `window.__molise.kit` = `{ assets, trees, cars }` o
`null`.

### Personalizzare macchine, alberi e cartelli

- **Auto**: la carrozzeria è la parte `car_sedan_01_paint`; il loader prepara una
  copia del materiale con colore bianco e ogni istanza riceve la sua tinta
  (`InstancedMesh.setColorAt`). La palette sta in `CAR_COLORS`
  (`src/world/city-props.ts`): dodici tinte da paese, niente colori da showroom.
  Cambiare l'array cambia tutte le auto parcheggiate.
- **Alberi**: scala 0,88–1,10 e rotazione casuale per istanza; il modello è uno
  solo, quindi la varietà è di taglia e orientamento.
- **Cartelli**: l'asset ha una faccia rettangolare già stampata. Per avere STOP,
  dare precedenza e limite 50 italiani si sostituisce la mappa della faccia con
  i canvas di `signTexture()` (già in `street-furniture.ts`, nessun asset).
  Operazione da fare quando si attiva il segnale del kit.
- **Targhe, fari, vetri**: sono parti separate (`..._plateW`, `..._lensClear`,
  `..._glass`), quindi si possono scurire, spegnere o cambiare senza toccare la
  carrozzeria.

---

## 5. Stato

| Passo | Stato |
| --- | --- |
| Censimento catalogo (2.288 asset, 937 free) | ✅ fatto |
| Script di acquisizione + manifest + licenza | ✅ fatto, `--list` e `--index` verificati |
| Download dei 13 GLB + manifest | ✅ fatto (13/13, indicizzati) |
| Loader runtime (Draco, pivot, istanze) | ✅ scritto, `tsc` pulito |
| Strade, marciapiedi, panchine, cestini, alberi, auto | ✅ integrati nel codice |
| Verifica visiva e fps | ⏳ **non eseguita** (richiesta di salto test/browser) |

Niente ✅ dove non c'è una prova: il codice compila e i test precedenti erano
verdi, ma la resa a schermo e il costo in fps vanno guardati in gioco.
