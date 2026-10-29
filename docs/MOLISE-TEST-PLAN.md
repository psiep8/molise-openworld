# Molise Open World — Piano di test (A guida · B terreno GLB · C umani)

**Come si usa:** segui l'ordine. Per ogni riga metti `[x]` se è OK, scrivi `KO` nel campo *Esito* se no, e annota cosa non va in *Note*. In fondo (§9) c'è lo spazio per le modifiche da chiedere e un prompt pronto da incollare all'AI.

Legenda priorità: **P0** = bloccante (se fallisce, il resto non conta) · **P1** = importante (le tue 3 richieste) · **P2** = rifinitura.

---

## ⚠️ Fase 0 — Controlla che la TUA cartella abbia davvero le modifiche (P0)

Analizzando gli zip che mi hai mandato (12 parti), **alcuni file chiave risultano ancora quelli vecchi**, anche se il report `MOLISE-3-UPGRADE-STATUS.md` dice che sono stati cambiati. Nei zip c'erano nuovi `surfaces.ts`, `ground-cover.ts`, `ground-kit-rules.ts`, `road-profile.ts`, `locomotion.ts` e i relativi test, ma **`car.ts`, `vehicle.ts`, `skid-marks.ts`, `player.ts`, `human-model.ts`, `pedestrians.ts`, `roadside-kit.ts`, `terrain.ts` non contenevano le modifiche descritte** (es. `car.ts` senza `vy`/`wheelSlip`, `skid-marks.ts` senza salvataggio su `localStorage`). Può darsi che i zip siano stati troncati (ogni parte ha ~45 file) e che la tua cartella vera sia a posto. **Verificalo tu**, dalla cartella del progetto (PowerShell o terminale):

```bash
# Dovrebbero tutti trovare almeno una riga. Se uno non trova nulla, quella modifica NON è nel tuo progetto.
grep -n "wheelSlip" src/sim/car.ts
grep -n "vy" src/sim/car.ts
grep -n "molise.skid-marks" src/entities/skid-marks.ts
grep -n "locomotion" src/entities/human-model.ts src/entities/player.ts src/world/pedestrians.ts
grep -n "surfaces" src/entities/vehicle.ts src/game.ts
grep -n "groundCover\|ground-cover" src/world/field-detail.ts
```
(Su Windows senza grep: `Select-String -Path src\sim\car.ts -Pattern wheelSlip`.)

| Controllo | Trovato? | Note |
| --- | --- | --- |
| `wheelSlip` in `car.ts` | [ ] sì [ ] no | |
| `molise.skid-marks` in `skid-marks.ts` | [ ] sì [ ] no | |
| `locomotion` in `human-model.ts` | [ ] sì [ ] no | |
| `locomotion` in `player.ts` | [ ] sì [ ] no | |
| `locomotion` in `pedestrians.ts` | [ ] sì [ ] no | |
| `surfaces` in `vehicle.ts` | [ ] sì [ ] no | |
| `ground-cover` in `field-detail.ts` | [ ] sì [ ] no | |

**Se qualcosa manca:** non testare quella sezione (darebbe falsi KO). Dillo all'AI: *"Nel mio progetto mancano queste modifiche: …; ricontrolla che i file siano stati salvati/committati e ripristinali."*

---

## 1. Preparazione: i comandi npm, uno per uno

Apri un terminale **nella cartella del progetto** (quella con `package.json`).

### 1.1 Requisiti (una volta sola)
1. **Node.js ≥ 22**. Controlla: `node -v` → deve mostrare `v22.x` o più alto. Se è più basso, installa Node 22 LTS da nodejs.org.
2. **Browser con WebGL2**: Chrome o Edge aggiornati (consigliati). Firefox va, ma i test di fps fallo in Chrome.
3. **GPU**: meglio una scheda dedicata o integrata recente. Se vedi il gioco a 5–25 fps probabilmente stai usando il rendering software (vedi §7).

### 1.2 Installazione (una volta, e ogni volta che cambia `package.json`)
```bash
npm ci
```
- Installa **esattamente** le versioni del `package-lock.json` (è più sicuro di `npm install`).
- Se dà errore, prova `npm install`. Se l'errore parla di `sharp` o permessi, chiudi editor/antivirus che bloccano `node_modules` e riprova.

### 1.3 Asset che NON sono nel repository (controlla prima di avviare)
| Cosa | Cartella | Se manca | Comando |
| --- | --- | --- | --- |
| Dati geografici (OSM, DEM, Sentinel) | `public/geo/` | il gioco non parte bene | `npm run geo` (è già committato; rigenera solo se serve) |
| **Copertura del suolo** (colori campi/boschi/prati) | `public/geo/landcover/` | terreno solo da foto satellitare, **tipi di terreno meno precisi** (importante per i test B e A superfici) | `npm run landcover` (scarica ~41 MB, qualche minuto) |
| Chioma alberi | `public/geo/canopy.bin` | alberi meno realistici | `npm run canopy` |
| Texture PBR | `public/textures/` | asfalto/muri piatti | `npm run textures` |
| **City kit** (panchine, cestini, alberi di strada…) | `public/citykit/` | arredo urbano mancante | `npm run kit` |
| **Auto GLB** (30 modelli) | `public/cars/` | si vedono solo auto procedurali: **i test di guida, ruote, fari e salita in auto sono meno attendibili** | copiale a mano (non sono in git per licenza) |
| World kit (zolle, erba, sassi, cartelli) | `public/worldkit/` | **il test B non ha senso** | è nel repo; se manca: `npm run worldkit` (richiede gli originali in `incoming-glb/`) |
| Personaggi (uomo/donna + clip) | cartella dei GLB umani | umani come cilindri/rig procedurale | sono nel repo |

### 1.4 Controlli automatici PRIMA di aprire il browser
Fai **tutti e tre**, in quest'ordine. Se uno fallisce, **fermati e copia l'errore** in §9.
```bash
npm test
```
- Lancia tutti i test (vitest). Atteso: **tutti verdi** (il report AI dice 461/461 in 53 file). Se vedi `FAIL`, annota il nome del file di test (es. `task-a-verification`, `skid-marks`, `locomotion`).
```bash
npm run build
```
- Controllo dei tipi TypeScript + build di produzione. Atteso: finisce senza `error TS…`. Un warning sulla dimensione dei chunk è normale.
```bash
npm run check:cars
```
- Legge i GLB delle auto (unità, proporzioni, pezzi staccati). Atteso: nessun errore sui modelli che userai per i test.

### 1.5 Avviare il gioco
**Modo sviluppo (consigliato per provare):**
```bash
npm run dev
```
Apri **http://127.0.0.1:5173** (non `localhost`). Lascia il terminale aperto. Per fermarlo: `Ctrl + C`.

**Modo "come in produzione" (per misurare gli fps davvero):**
```bash
npm run build
npm run preview
```
Apri **http://127.0.0.1:4173**. Il dev server è più lento: **gli fps veri li misuri qui**.

**Smoke test automatico** (Chrome headless; richiede `preview` già acceso in un altro terminale):
```bash
npm run smoke
```
Atteso: carica, guida, cammina, nessun errore in console, salva `smoke/shot.png` (apri l'immagine e guarda che il mondo si veda). Su PC senza GPU può andare in timeout: non è un KO del gioco, annotalo.

**Benchmark (opzionale):** `npm run bench` — misura fps/draw call/triangoli a preset diversi; copia i numeri in §7.

**Demo dei bundle geografici (solo se serve)**: terminale 1 `npm run world:demo`, terminale 2 `npm run dev:demo`.

### 1.6 Indirizzi utili (aggiungi dopo l'indirizzo base)
| URL | Cosa fa |
| --- | --- |
| `/?autostart=drive` | parte subito in auto (per i test di guida) |
| `/?autostart=walk` | parte subito a piedi |
| `/?quality=high` (o `ultra`, `medium`, `low`, `minimal`) | forza il preset grafico |
| `/?at=41.9237,14.7975` | parte in un punto preciso (lat,lon) |
| `/?bench=1` | pose fisse per misure riproducibili (copertura terreno, fps) |
| `/harness.html?view=head` | prova i personaggi su prato neutro (volto) |
| `/harness.html` | personaggi figura intera |

Combinali: `http://127.0.0.1:5173/?autostart=drive&quality=high`.

### 1.7 Prima di ogni sessione di test
- Apri gli **Strumenti sviluppatore** (`F12`) → scheda **Console**. Deve restare **senza errori rossi**. Ogni errore rosso va annotato.
- Per resettare lo stato salvato (preset, tracce): in Console `localStorage.clear()` e ricarica. Chiavi usate: `molise.quality`, `molise.skid-marks`.
- Ricarica con `Ctrl + Shift + R` dopo ogni modifica di codice.
- In Console puoi leggere: `window.__molise` (fps, drawCalls, triangles, errori, qualità, gpu). Scrivi `__molise.fps` per gli fps.

---

## 2. Tasti (promemoria)
| Tasto | A piedi | In auto |
| --- | --- | --- |
| `W A S D` | muoviti | accelera / sterza / frena (da fermo: retro) |
| `Shift` | corri | spinta |
| `Spazio` | salta | **freno a mano** |
| `F` | sali in auto vicina | scendi |
| `J` | — | fari accesi anche di giorno |
| `,` `.` | — | frecce |
| `O` | — | autopilota |
| `Q` | meteo successivo | meteo successivo |
| `P` | impostazioni (meteo, **ora del giorno**, veicolo, personaggio) | idem |
| `G` | cambia preset grafico | idem |
| `B` | cambia veicolo | idem |
| `C` | camera 1ª/3ª persona | camera inseguitrice/alta/cofano |
| `R` | riporta in strada | idem |
| `L` / `T` | torna a casa / imposta garage | idem |
| `M` / `V` | mappa grande / satellite-vettoriale | idem |
| `N` | audio on/off | idem |
| `H` | aiuto | — |

**Come ottenere le condizioni di prova:** `P` → scegli *sereno / nuvoloso / pioggia / neve / nebbia* e sposta lo slider dell'**ora** (0–24: usa 14 per giorno, 22 per notte, 6 e 18 per alba/tramonto). Con "Meteo reale" attivo il meteo dipende da Open-Meteo: **spegnilo** per test ripetibili. Dopo la pioggia l'asfalto resta bagnato per un po': attendi 1–2 minuti di gioco per vedere l'effetto completo.

---

## 3. P0 — Sanity (devi passarli prima di tutto)

| ID | Azione | Atteso | OK | Esito/Note |
| --- | --- | --- | --- | --- |
| S1 | `npm test`, `npm run build` | verdi | [ ] | |
| S2 | Apri `/?autostart=walk&quality=medium` | il mondo si vede, nessun schermo nero, **Console senza errori rossi** | [ ] | |
| S3 | Cammina 30 s in ogni direzione | nessun crash, nessun blocco > 1 s | [ ] | |
| S4 | `F` vicino a un'auto, guida 60 s, `F` per scendere | sali/scendi senza errori, personaggio coerente | [ ] | |
| S5 | `G` ripetuto per tutti i preset | nessun crash, nessun buco nero nel mondo | [ ] | |
| S6 | Ricarica la pagina (F5) | riparte senza errori; preset ricordato | [ ] | |
| S7 | Preset `minimal` (`?quality=minimal`) | resta giocabile (anche se spoglio) | [ ] | |

---

## 4. TASK A — Guida, superfici, meteo, luci, tracce (P1)

Usa **`/?autostart=drive&quality=high`**, meteo manuale (P), ora 14 salvo diversa indicazione. Prova almeno **3 veicoli diversi** (`B`): una utilitaria (Fiat Panda/Punto/500), una sportiva a trazione posteriore (Porsche 911 / BMW M4), un fuoristrada/van (Defender / Crafter). Annota quale hai usato.

### 4.1 Comportamento base (asfalto asciutto)
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| A1 | Parti da fermo a gas pieno | accelerazione credibile, cambio automatico, giri che salgono e scendono | [ ] | |
| A2 | Rilascia il gas | rallenta dolcemente (freno motore), non si ferma di colpo | [ ] | |
| A3 | Curva a 30 km/h con sterzo pieno | raggio stretto (~8 m), niente "tram" né sbandata | [ ] | |
| A4 | Curva a 50 km/h | raggio ~15 m; l'auto si inclina (rollio) verso l'esterno | [ ] | |
| A5 | Curva a 100 km/h con sterzo pieno | **non** gira come a 30: tende ad allargare/sottosterzare | [ ] | |
| A6 | Frena forte da 100 km/h in rettilineo | muso giù (beccheggio), fermata in ~40–60 m, auto dritta | [ ] | |
| A7 | Retromarcia (da fermo premi `S`) | parte indietro, `W` torna avanti senza fermarsi del tutto | [ ] | |
| A8 | Salita ripida / discesa | si sente la pendenza (rallenta in salita, accelera in discesa) | [ ] | |
| A9 | Cordolo preso di taglio | colpo alla carrozzeria + rallentamento, niente teletrasporto | [ ] | |

### 4.2 Freno a mano e derapata (la tua richiesta principale)
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| A10 | A 60 km/h dritto: `Spazio` + sterzo a destra | il **posteriore scivola**, l'auto ruota (anche testacoda > 90°); rilascia → recupera | [ ] | |
| A11 | Stessa prova a 20 km/h | giro più lento/piccolo, niente scatto innaturale | [ ] | |
| A12 | Stessa prova su **terra** | derapata più ampia e più facile che su asfalto | [ ] | |
| A13 | Stessa prova su **erba/fango** | scivola molto, perde velocità, affonda | [ ] | |
| A14 | Freno a mano in rettilineo senza sterzo | l'auto si ferma restando quasi dritta, ruote bloccate (segno sull'asfalto) | [ ] | |
| A15 | Derapata prolungata, poi lascia tutto | l'auto si raddrizza, nessun "impazzimento" (oscillazioni infinite) | [ ] | |
| A16 | Auto **trazione posteriore** a gas pieno in curva | la coda tende ad uscire; **la Panda/FWD** tende invece a sottosterzare | [ ] | |
| A17 | Spazio + Shift (spinta) | più potente, ma sempre entro il limite di aderenza | [ ] | |

### 4.3 Superfici
Fai la stessa prova (accelera a fondo, frena a fondo, curva) su ogni superficie e annota differenze.
| ID | Superficie | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| A20 | Asfalto | massimo grip | [ ] | |
| A21 | Sterrato / terra battuta | frenata più lunga, coda che scivola, polvere | [ ] | |
| A22 | Ghiaia | simile alla terra, rumore/sassi | [ ] | |
| A23 | Erba | poco grip, molta resistenza, velocità massima ridotta | [ ] | |
| A24 | Fango (dopo pioggia, su terra) | grip minimo, affondamento, solchi, schizzi | [ ] | |
| A25 | Cordoli/marciapiede/ponte | quota coerente, nessuna auto "sotto" il ponte | [ ] | |
| A26 | **Una ruota su asfalto e una su erba** (lato strada) | l'auto **tira da un lato** | [ ] | |
| A27 | Passaggio asfalto → terra in curva | nessun salto brusco di velocità o direzione | [ ] | |

### 4.4 Meteo
| ID | Condizione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| A30 | Sereno vs pioggia: frena da 100 km/h | su pioggia spazio di frenata **chiaramente più lungo** | [ ] | |
| A31 | Pioggia: accelera a gas pieno | ruote che pattinano più facilmente | [ ] | |
| A32 | Pioggia intensa, > 90 km/h, curva o frenata | possibile **aquaplaning** (auto "galleggia", poco controllo) | [ ] | |
| A33 | Neve | grip molto basso; frenate lunghissime; solchi | [ ] | |
| A34 | Gelo + bagnato (ghiaccio) | quasi nessuna aderenza | [ ] | |
| A35 | Smette di piovere | l'asciugatura è graduale (non istantanea) | [ ] | |
| A36 | Terra/erba con pioggia | si trasforma in fango (più scivolosa della stessa zona asciutta) | [ ] | |
| A37 | Spray ruote | acqua sollevata con pioggia, polvere su terra | [ ] | |

### 4.5 Frenate e sgommate che restano (tracce)
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| A40 | Partenza a gas pieno con ruote che pattinano su **asfalto** | striscia scura continua dietro le ruote | [ ] | |
| A41 | Frenata a fondo (o freno a mano) su **asfalto** | segni neri dritti che restano | [ ] | |
| A42 | Derapata ampia su asfalto | segni curvi continui, non "pezzi staccati" | [ ] | |
| A43 | Stesso su **terra / ghiaia** | solco più chiaro/scuro che resta | [ ] | |
| A44 | Su **erba** | strisce di erba schiacciata/terra | [ ] | |
| A45 | Su **fango** e **neve** | solchi profondi/scuri | [ ] | |
| A46 | Sul **bagnato** | segni **meno visibili** che sull'asciutto | [ ] | |
| A47 | Allontanati 300–500 m e torna | **le tracce sono ancora lì** | [ ] | |
| A48 | Aspetta 2 minuti di gioco | sbiadiscono lentamente, non spariscono dopo 14 s | [ ] | |
| A49 | Ricarica la pagina (F5), torna nel punto | le tracce sono ancora lì (salvate nel browser, chiave `molise.skid-marks`) | [ ] | |
| A50 | Fai tante sgommate (≥ 2 min) | fps stabili (budget tracce rispettato), le più vecchie spariscono per prime | [ ] | |
| A51 | Curve molto strette con tracce | **limite noto:** i segmenti possono compenetrarsi; annota se è brutto | [ ] | |
| A52 | `minimal`/`low` | poche o nessuna traccia (normale), nessun errore | [ ] | |

### 4.6 Luci e riflessi
Ora 22 (notte), `?quality=high`.
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| A60 | Fari accesi di notte | fascio ben illuminato davanti; la strada si accende | [ ] | |
| A61 | Stessa scena con **pioggia** | **riflesso allungato** dei fari sull'asfalto, più forte che sull'asciutto | [ ] | |
| A62 | Fanali posteriori (guarda l'auto dall'esterno con `C`) | luci rosse accese, **bagliore rosso sulla strada dietro** | [ ] | |
| A63 | Frena | **luci stop** molto più forti, riflesso rosso più intenso | [ ] | |
| A64 | Retromarcia | luci bianche dietro | [ ] | |
| A65 | `J` di giorno | fari accesi anche col sole | [ ] | |
| A66 | Frecce `,` `.` | lampeggio ritmico (acceso/spento), non fisso | [ ] | |
| A67 | Altre auto/pedoni vicino | nessun calo di fps evidente per le luci | [ ] | |
| A68 | `minimal`/`low` | luci "finte" (emissive/decal), nessun errore | [ ] | |

### 4.7 Audio e HUD
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| A70 | Sgommata / derapata | **stridio gomme** diverso su asfalto e su terra | [ ] | |
| A71 | Frenata con ABS | pulsazione/feedback (se previsto) | [ ] | |
| A72 | Aquaplaning/slittamento | indicazione a schermo (HUD) | [ ] | |
| A73 | Cordolo | rumore d'urto | [ ] | |
| A74 | Motore | il suono segue i giri, cambia con la marcia | [ ] | |

---

## 5. TASK B — Terreno fatto di GLB, strade e infrastrutture (P1)

Usa **`/?autostart=walk&quality=high`** (e poi `ultra`/`medium`). Prima `npm run landcover` (vedi 1.3), altrimenti i tipi di terreno non variano.

### 5.1 Il terreno "2D" è sparito?
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| B1 | Cammina in un **prato / campo** guardando in basso | vedi zolle, erba, terra con **volume e variazione**, non un piano texturizzato | [ ] | |
| B2 | Guarda verso l'orizzonte a ~20–60 m | continuità fra GLB e terreno lontano senza "bordo" visibile | [ ] | |
| B3 | Zona **bosco** | sottobosco e terra da bosco, diverso dal prato | [ ] | |
| B4 | Zona **coltivo** | file di coltivo / terra lavorata | [ ] | |
| B5 | **Roccia / pendio ripido** | zolle diverse (roccia/ripa) | [ ] | |
| B6 | Cerca **buchi** (cielo/colore piatto fra le zolle) | nessun buco entro ~40 m (a `high`) | [ ] | |
| B7 | **Fessure** fra le zolle | nessuna linea chiara fra zolle contigue | [ ] | |
| B8 | **Ripetizione** | non si nota lo stesso pezzo copiato in serie (rotazioni/tinte variano) | [ ] | |
| B9 | **Z-fighting** (sfarfallio) | nessuno sfarfallio fra zolle sovrapposte, strada, erba | [ ] | |
| B10 | Zolle sul **rilievo** | seguono la collina, non galleggiano né affondano | [ ] | |
| B11 | Dopo la **pioggia** | la terra smossa diventa fango (zolle di fango) | [ ] | |
| B12 | Oltre ~60 m | **limite noto:** oltre 60 m resta DEM + satellite. Annota se il passaggio è brutto | [ ] | |
| B13 | Muoviti velocemente (corsa/auto 120 km/h) | il terreno si aggiorna **senza scatti** né "pop" evidenti | [ ] | |
| B14 | Preset diversi (`low` → `ultra`) | più raggio di copertura salendo di preset (8/22/38/54 zolle) | [ ] | |

### 5.2 Fisica = grafica (terreno)
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| B20 | Cammina/guida sul fango visibile | la fisica è da fango (lenta, scivolosa) | [ ] | |
| B21 | Passa dall'erba alla terra | cambia il comportamento dell'auto di conseguenza | [ ] | |
| B22 | Piedi/ruote a terra | nessuno "sotto" o "sopra" la zolla (niente fluttuazione) | [ ] | |

### 5.3 Strade, marciapiedi, cordoli, cunette, guardrail
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| B30 | Marciapiedi in paese (Palata) | moduli GLB **continui**, senza buchi né sovrapposizioni brutte, +18 cm sull'asfalto | [ ] | |
| B31 | Cordoli | allineati col marciapiede, nessun gradino strano | [ ] | |
| B32 | Angoli e incroci | raccordi ragionevoli | [ ] | |
| B33 | Strade di campagna (fuori paese) | **non** ci sono lastre sparse ogni 18–44 m (comportamento vecchio) | [ ] | |
| B34 | **Cunette / banchine** ai lati delle strade rurali | rientranze o fasce laterali visibili | [ ] | |
| B35 | **Guardrail** | continui lungo il lato a valle, con terminali, **solidi** (l'auto ci sbatte) | [ ] | |
| B36 | Ponti | impalcato giusto, l'auto passa **sopra**, non sotto | [ ] | |
| B37 | Segnaletica/pali luce | ancora presenti e allineati | [ ] | |
| B38 | Palata riconoscibile | strade ed edifici come prima (piazza, chiesa) | [ ] | |

### 5.4 Prestazioni del terreno
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| B40 | Guida in auto 60 s a 120 km/h | niente freeze > 1 s; hitch rari | [ ] | |
| B41 | `__molise.drawCalls`, `__molise.triangles` | annotali a `medium` e `high` (§7) | [ ] | |
| B42 | Gioca 5 minuti girando molto | la memoria non cresce senza fine (Task Manager del browser) | [ ] | |
| B43 | `/?bench=1` | pose fisse, copertura circa 24/30 celle (report AI) | [ ] | |

---

## 6. TASK C — Esseri umani (P1)

Prova con **uomo e donna** (`P` → personaggio) e diverse altezze/corporature. Per i dettagli usa anche `/harness.html`.

### 6.1 Camminata e corsa
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| C1 | Fermo | idle naturale (respiro/lievi movimenti se presenti) | [ ] | |
| C2 | Cammina | passo fluido, **piedi che non pattinano** | [ ] | |
| C3 | `Shift` corsa | transizione morbida camminata → corsa, senza scatto | [ ] | |
| C4 | Rilascia la corsa | transizione morbida corsa → camminata → idle | [ ] | |
| C5 | Inversione rapida della direzione | nessun moonwalk / torsione innaturale | [ ] | |
| C6 | Salto (`Spazio` a piedi) | fasi decollo/volo/atterraggio leggibili | [ ] | |
| C7 | **Salita/discesa** ripida | il corpo si inclina col pendio; piedi a terra | [ ] | |
| C8 | Gradino / cordolo 18 cm | **limite noto:** il piede può "attraversare" il bordo. Annota quanto è evidente | [ ] | |
| C9 | Con la terza persona (`C`) | la camera segue senza tremare | [ ] | |

### 6.2 Salire e scendere dall'auto
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| C10 | `F` vicino a un'auto | il personaggio **cammina fino alla portiera, si siede** (~0,6 s), poi l'auto parte | [ ] | |
| C11 | Durante l'ingresso premi tasti di guida | input **bloccato** finché non è seduto | [ ] | |
| C12 | `F` due volte di fila | la seconda pressione **non interrompe** l'animazione | [ ] | |
| C13 | Posa da seduto (guarda dall'esterno con `C`) | gambe/busto in posizione sensata, **nessuna rotazione al contrario** di cosce/ginocchia (verificare con le ossa del GLB) | [ ] | |
| C14 | Mani sul volante / piedi sui pedali | **non previsto nel report**: annota se manca | [ ] | |
| C15 | `F` per scendere | si alza, **fa un passo fuori** (~0,65 s) dal lato giusto | [ ] | |
| C16 | Scendi mentre l'auto è in movimento | idealmente rifiutato sopra ~3 km/h (annota cosa succede) | [ ] | |
| C17 | Prova con **moto/scooter** | pilota in sella, piega in curva | [ ] | |
| C18 | Entra/esci 10 volte di fila | nessun errore, nessun personaggio bloccato o dentro la carrozzeria | [ ] | |
| C19 | Usa `R`/`L` durante l'animazione | stato coerente dopo il teletrasporto | [ ] | |
| C20 | Ripeti con **auto diverse** (piccola, SUV, furgone) | il punto-portiera/sedile è plausibile per ognuna | [ ] | |

### 6.3 Pedoni
| ID | Azione | Atteso | OK | Note |
| --- | --- | --- | --- | --- |
| C30 | Guarda i pedoni in paese | camminano sui marciapiedi, **seguono il pendio**, si fermano ogni tanto | [ ] | |
| C31 | Avvicinati (< 90 m) | animazione completa; oltre 90 m ferme/ricicate | [ ] | |
| C32 | Guida verso un pedone | **limite noto:** non è previsto che reagiscano/ragdoll. Annota il comportamento | [ ] | |
| C33 | Molti pedoni insieme | fps accettabili | [ ] | |

### 6.4 Aspetto e anatomia (stato "da migliorare")
| ID | Domanda | Voto 1–5 | Note |
| --- | --- | --- | --- |
| C40 | Il corpo sembra ancora un "manichino"? Dove? (spalle, mani, faccia, pelle) | | |
| C41 | Proporzioni e deformazioni (ginocchia, gomiti, spalle) | | |
| C42 | Volto/occhi/capelli | | |
| C43 | Varietà fra uomo/donna/altezze/corporature | | |
| C44 | Vestiti | | |
| C45 | Movimento delle mani/braccia | | |

> **Non ancora fatto (dal report AI):** ragdoll, nuove clip mocap, IK a due ossa dei piedi, cambi anatomici, mani sul volante. Se li vuoi, scrivili in §9.

---

## 7. Prestazioni e qualità (P1)

Misura in **`npm run preview`** (:4173), non in dev. Scrivi gli fps con `__molise.fps` dopo 10 s fermo.

| Preset | Scena | fps | drawCalls | triangles | Note |
| --- | --- | --- | --- | --- | --- |
| minimal | Piazza di Palata, ferma | | | | |
| low | idem | | | | |
| medium | idem | | | | |
| high | idem | | | | |
| ultra | idem | | | | |
| high | Campagna (`?bench=1`) | | | | |
| high | Guida notte + pioggia + fari | | | | |
| high | 2 min di derapate (tracce piene) | | | | |

- [ ] Se gli fps sono 5–25: controlla `__molise.gpu`. Se dice *SwiftShader/llvmpipe/software*, **non stai usando la GPU** (attiva l'accelerazione hardware del browser: `chrome://settings` → Sistema → "Usa accelerazione hardware").
- [ ] Il gioco **degrada da solo** sotto i 26–34 fps (ombre → erba → meteo → raggio): annota se succede e a che punto (`__molise.degraded`).
- [ ] Memoria stabile dopo 10 minuti di gioco.

---

## 8. Regressioni: cose che funzionavano prima e NON devono rompersi (P2)

| ID | Cosa | OK | Note |
| --- | --- | --- | --- |
| R1 | Menu e impostazioni (`P`): meteo, ora, veicolo, colore, personaggio | [ ] | |
| R2 | Garage (`T`, `L`) e colore auto (`K`) | [ ] | |
| R3 | Salvataggio e dormire a casa (`E`) | [ ] | |
| R4 | Economia/attività: entra in un negozio (`E`), compra, portafoglio (`I`) | [ ] | |
| R5 | Mappa grande (`M`), itinerario (click), `X`, radar `V` | [ ] | |
| R6 | Autopilota (`O`) | [ ] | |
| R7 | Ciclo giorno/notte, nuvole, pioggia, neve, nebbia | [ ] | |
| R8 | Vento: alberi ed erba si muovono | [ ] | |
| R9 | Edifici con tetti e facciate, chiesa, piazza | [ ] | |
| R10 | Stereo (`Y`) | [ ] | |
| R11 | Audio on/off (`N`) | [ ] | |
| R12 | Import auto da Smooth Voxels (trascina un GLB) | [ ] | |
| R13 | Console senza errori per 10 minuti di uso misto | [ ] | |

---

## 9. Le TUE modifiche da chiedere

### 9.1 Elenco (scrivi qui, in ordine di importanza)
| # | Area (A/B/C/Altro) | Cosa NON va / cosa voglio | Dove l'ho visto (ID test, luogo, auto, meteo) | Priorità (P0/P1/P2) | Fatto? |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | [ ] |
| 2 | | | | | [ ] |
| 3 | | | | | [ ] |
| 4 | | | | | [ ] |
| 5 | | | | | [ ] |
| 6 | | | | | [ ] |
| 7 | | | | | [ ] |
| 8 | | | | | [ ] |
| 9 | | | | | [ ] |
| 10 | | | | | [ ] |

### 9.2 Errori in console / test falliti (copia/incolla il testo)
```
(incolla qui gli errori rossi o l'output di npm test / npm run build)
```

### 9.3 Cose belle da NON toccare
-
-

### 9.4 Prompt pronto da incollare all'AI
```
Ho testato il progetto Molise Open World con MOLISE-TEST-PLAN.md. Ecco i risultati.
Contesto: leggi MOLISE-3-UPGRADE-BRIEF.md (§1 e §2) e MOLISE-3-UPGRADE-STATUS.md.

Fase 0: verifica nel repository che queste modifiche siano presenti: <incolla la tabella della Fase 0>.

Problemi da correggere, in ordine di priorità (sono nel §9.1): <incolla la tabella>.
Errori in console / test falliti: <incolla §9.2>.
Non toccare: <incolla §9.3>.

Regole: lavora un problema alla volta; per ognuno scrivi prima la causa probabile, poi la correzione,
poi un test vitest se la logica è pura. Alla fine lancia npm test e npm run build e dimmi cosa NON hai
potuto verificare a schermo. Non rompere le regole del brief (coordinate, ground sampler unico,
determinismo, preset di qualità).
```

---

## 10. Cosa penso sia più importante testare (i miei consigli)

1. **Fase 0** (le modifiche ci sono davvero?) — senza questo tutti gli altri esiti sono ambigui.
2. **A10–A15 (freno a mano e derapata) e A40–A49 (tracce persistenti):** sono le tue richieste più concrete e quelle con più rischio di "sembra fatto ma non si vede".
3. **A30–A36 (pioggia/neve/fango):** verifica la differenza fra superfici, non solo "più scivoloso".
4. **B1–B9 e B13 (terreno senza buchi, senza sfarfallio, senza scatti in velocità):** è il punto più fragile (il report dice che oltre 60 m resta il vecchio terreno).
5. **C10–C15 (salita/discesa dall'auto):** il report dice esplicitamente che la direzione delle rotazioni da seduto **non è stata guardata a schermo**.
6. **Prestazioni (§7):** i nuovi sistemi possono pesare; misura a `medium` e `high` in `preview`, non in `dev`.
7. **Console senza errori:** un errore rosso silenzioso spesso spiega un comportamento strano.

Tip: fai uno **screenshot o una breve registrazione** di ogni problema (e scrivi il preset, l'ora e il meteo): per un'AI è la cosa più utile per correggere bene.
