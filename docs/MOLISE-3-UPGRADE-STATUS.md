# Molise 3 — stato upgrade A/B/C

Aggiornato il 29 ottobre 2026. Descrive ciò che è stato implementato e
verificato su `upgrade/molise-3-task-a-b` e sul ramo del Task C. Le verifiche
visive in gioco restano indicate esplicitamente quando non eseguite.

## Task A — guida, superfici e tracce

### Implementato

- Modello laterale planare con velocità `vx`/`vy`, imbardata, slip per ruota,
  trasferimento di carico longitudinale e laterale, grip combinato e passaggi
  dinamici suddivisi a 1/120 s.
- Materiali di contatto con grip peak/slide, resistenza al rotolamento e
  affondamento; il meteo influenza il grip per superficie. L'aquaplaning
  dipende dall'acqua stagnante e dalla velocità; terra ed erba umide interpolano
  verso il comportamento del fango.
- Contatto superficie campionato alle quattro ruote, input di sterzo/gas/freno
  addolciti e supporto al freno a mano/ABS nel modello di aderenza.
- Sterzo calibrato: sotto ~24 km/h resta quasi tutto il lock (manovra di
  parcheggio), sopra cala in modo progressivo.
- Tracce in coordinate mondo, budget per preset, memoria per chunk durante la
  sessione **e su `localStorage`** (`molise.skid-marks`, versione 2). Ogni ruota
  concatena i punti in un nastro continuo; il salvataggio conserva posizione,
  direzione, lunghezza e forza, quindi dopo un riavvio il nastro non torna una
  fila di quad.
- Riflessi decal di fari/stop, luci posteriori e feedback di slittamento audio/HUD.

### Verificato

- `tests/task-a-verification.test.ts`: ABS sì/no (lo slittamento senza ABS è
  maggiore), frenata sul bagnato più lunga, distanza di arresto per tutti i
  veicoli nella forchetta della decelerazione dichiarata, confronto FWD/RWD/AWD,
  raggio di sterzo a 30 km/h e stabilità a 30/60/144 fps con input funzione del
  tempo.
- `tests/skid-marks.test.ts`: geometria del nastro senza buchi e round-trip su
  storage con lunghezza e direzione.

### Limiti

- Il nastro è ancora fatto di segmenti rettilinei accostati, non di una mesh
  continua con UV: a curve molto strette i segmenti si compenetrano invece di
  piegarsi.
- Lo storage è locale al browser, non al profilo di gioco: cancellando i dati del
  sito le tracce spariscono.
- La conferma a schermo di ABS, acquaplano e usura delle tracce resta da fare su
  GPU reale.

## Task B — terreno GLB e infrastruttura stradale

### Implementato

- Nuovo pianificatore puro `src/world/ground-cover.ts`: griglia contigua,
  nessuna estrazione casuale, scala calcolata per sovrapporre le zolle dell'8%
  (niente fessure), orientamento al gradiente DEM e quota dal `GroundMask`.
- Copertura su due livelli: `lod 1` entro ~1,9 passi (zolle scelte da copertura,
  superficie, pendenza e distanza strada), `lod 2` oltre (solo copertura). Il
  raggio nasce dal budget del preset (`groundDetail` 8/22/38/54) e arriva a 60 m.
  Con 22 zolle il preset medio copre ~40 m, con 54 arriva al tetto.
- Fotogrammetrie piccole (5 m) solo entro ~24 m e solo se il budget lo consente:
  riempiono i buchi dove si guarda da vicino.
- Fango collegato al meteo: `groundKitSlugAt` accetta `wetness`; la terra smossa
  diventa `ground-mud` con probabilità crescente sotto la pioggia, e con bagnato
  > 0,7 compaiono chiazze anche nelle praterie basse. La superficie restituita
  alla fisica è `mud` (grip 0,35, affondamento 0,65), non più `dirt` camuffato.
- Il piano viene rifatto solo se il giocatore si sposta di 15 m o se bagnato,
  budget o densità cambiano oltre la soglia: niente ricostruzione a ogni frame.
  `WorldFieldDetail.coverageStats()` espone copertura, riempimento, celle
  bloccate, conteggio LOD, triangoli stimati e durata dell'ultima ricostruzione.
- Arredo urbano GLB continuo (`src/world/roadside-kit.ts`): moduli accostati lungo
  la tangente su entrambi i lati dei tratti con `walkSpans`, alla quota del
  profilo stradale (18 cm sopra l'asfalto), con sovrapposizione del 2%; prima
  erano lastre sparse ogni 18–44 m anche fuori dal paese.

### Verificato

- `tests/ground-cover.test.ts`: nessun buco fra celle adiacenti, rispetto del
  budget, celle bloccate escluse ma contate, separazione LOD 1/2, stima
  triangoli, inclinazione su piano noto.
- `tests/ground-kit-rules.test.ts`: fango asciutto/bagnato, prateria bagnata,
  bosco escluso, `wetness` fuori scala rifiutato.
- `npx tsc --noEmit`, suite completa e build passano.

### Limiti

- La generazione non usa un Web Worker: il piano è puro e limitato (decine di
  celle) e viene eseguito sul thread principale; `planMs` misura il costo, ma non
  c'è ancora un trasferimento asincrono.
- Non c'è un overlay grafico di copertura: le metriche sono disponibili via
  `coverageStats()` e nei test, non disegnate in mappa.
- Oltre 60 m il suolo resta DEM + landcover + satellite: riempirlo tutto con GLB
  richiederebbe streaming di zolle su tutta la mappa, non implementato.
- Marciapiedi e cordoli procedurali restano l'autorità fisica; i moduli GLB li
  rivestono. La continuità e la quota vanno confermate a schermo sul DEM reale.

## Task C — animazione umana

### Implementato

- Nuovo modulo puro `src/entities/locomotion.ts`: pesi idle/camminata/corsa
  normalizzati, blend esponenziale indipendente dal frame rate, stato dominante,
  velocità delle clip, sincronizzazione della falcata, inclinazione dal DEM sotto
  i due piedi, quote dei piedi, avanzamento delle transizioni e posa seduta
  additiva.
- `HumanBody` usa il blend puro; trova le ossa di coscia, polpaccio, braccio e
  busto e applica la posa seduta solo durante la transizione, ripristinando la
  posa di riposo prima del mixer per non accumulare offset.
- `Player` usa gli stessi pesi per il rig procedurale, inclina il corpo sul
  pendio e appoggia l'avatar sulla media dei due piedi invece della quota del
  centro. `Pedestrians` fa lo stesso per i pedoni entro 90 m.
- Ingresso/uscita auto a tempo: 0,6 s per salire (il personaggio cammina fino
  alla portiera, si siede e solo alla fine l'auto prende il controllo) e 0,65 s
  per scendere (si alza e fa un passo fuori). L'input è bloccato durante la
  transizione e un secondo `F` non la interrompe.

### Verificato

- `tests/locomotion.test.ts`: normalizzazione, monotonia del passaggio
  camminata→corsa, convergenza e indipendenza dal frame rate del blend, stato
  dominante, clamps delle clip, fase di falcata, segni dell'inclinazione su un
  piano noto, saturazione delle transizioni, posa seduta monotona, quote dei
  piedi.
- Suite completa, typecheck e build passano.

### Limiti

- Non ci sono rag-doll, nuove clip di motion capture né cambi anatomici: restano
  fasi successive.
- L'adattamento al terreno è inclinazione del corpo + quota media dei piedi, non
  IK a due ossa: su scalini netti il piede può ancora attraversare il bordo.
- Il rig procedurale di fallback non ha la posa seduta (solo il corpo GLB).
- La direzione delle rotazioni della posa seduta sulle ossa Mixamo non è stata
  verificata a schermo: i valori sono additivi e limitati, ma vanno guardati in
  gioco.

## Verifiche di questa sessione

- `npx tsc --noEmit` ✅
- `npx vitest run` **461/461** ✅ in 53 file
- `npm run build` ✅
- Controllo runtime sul build servito da `vite preview`: modalità a piedi e a
  guida avviate, uscita dall'auto → camminata → rientro in auto senza errori in
  console (`errorCount: 0`), a 24,7 fps su GPU software.
- Controllo visivo sul dev server, preset `high`, scena di campagna (`?bench=1`):
  copertura 24/30 celle piantabili (fill 0,8), 397.396 triangoli, ultima
  ricostruzione 53 ms; il minimo radar mostra il satellite reale di Palata e i
  marciapiedi procedurali hanno i moduli GLB accostati. I campi vicini hanno
  materia (file di coltivo, erba, terra), mentre i crinali oltre 60 m restano
  DEM/landcover come previsto.
- `npm run smoke` completo: la prima scheda ha guidato e reso l'immagine, ma il
  rerun con la scheda `autostart=walk` è andato in timeout sotto SwiftShader e
  non viene contato come prova superata.
- La posa seduta sulle ossa non è stata giudicata a schermo: la transizione
  funziona (ingresso e uscita completano, nessun errore), ma la direzione delle
  rotazioni va guardata da vicino.
