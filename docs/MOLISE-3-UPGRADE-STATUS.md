# Molise 3 — stato upgrade A/B/C

Aggiornato il 29 ottobre 2026. Questo riepilogo descrive le modifiche locali
incluse nel branch `upgrade/molise-3-task-a-b`; non sostituisce le verifiche
in gioco.

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
- Tracce localizzate in coordinate mondo, limitate dal budget qualità,
  memorizzate per chunk durante la sessione e ricaricate quando l'auto torna
  nell'area; pioggia e neve ne accelerano il decadimento.
- Riflessi decal di fari/stop, luci posteriori e feedback di slittamento audio/HUD.

### Da completare o verificare

- Calibrare e misurare frenate, raggi di sterzata e accelerazione per veicolo,
  confronto ABS/no-ABS, FWD/RWD/AWD e stabilità ai frame rate richiesti.
- Le tracce sono ancora quad indipendenti, non nastri continui; la memoria per
  chunk vive solo nella sessione e non viene salvata tra riavvii.
- Verificare in gioco grip, affondamento, aquaplaning, luci e tracce su
  superfici/meteo diversi. Gli effetti di `sink` sono una resistenza
  longitudinale approssimata, non deformazione visiva del terreno.

## Task B — terreno GLB e infrastruttura stradale

### Implementato in forma parziale

- Selezione deterministica di zolle GLB locali da copertura, superficie,
  pendenza e distanza dalla strada; orientamento al gradiente DEM e priorità
  alle istanze più vicine al giocatore. DEM e `WorldGround` restano l'autorità
  fisica.
- Sezione stradale pura condivisa dal rendering e da `RoadIndex`: banchina,
  cunetta/scarpata rurale e cordolo/marciapiede urbano, con raccordo esterno al
  DEM. Ponti e gallerie non ricevono il profilo rurale.

### Da completare o verificare

- Non sono implementati copertura continua a 60 m, LOD L1/L2, overlay di
  copertura, generazione in worker né misure di hitch e budget.
- L'infrastruttura GLB urbana resta selettiva/procedurale, non una sostituzione
  continua di marciapiedi e cordoli. Il fango del ground kit non è collegato
  direttamente all'intensità meteo.
- Verificare i profili sul DEM reale e la continuità in gioco, oltre a coverage,
  triangoli/draw call, streaming e memoria.

## Task C — animazione umana

**Non implementato.** Avvio suggerito, dopo le verifiche A/B:

- Branch di lavoro predisposto: `upgrade/molise-3-task-c`, basato sul branch
  pubblicato A/B. Nessuna modifica runtime di C è inclusa finché non partono
  l'inventario dei rig/clip e l'implementazione del primo incremento.

1. Inventariare `human-model.ts`, `player.ts`, `pedestrians.ts` e i clip/rig
   disponibili; mantenere le animazioni e gli asset esistenti come fallback.
2. Separare una macchina a stati pura per locomozione e blend, con test di pesi,
   transizioni e stride matching prima di cambiare il rendering.
3. Integrare gradualmente adattamento dei piedi al terreno e sequenze di
   ingresso/uscita dall'auto; limitare IK e aggiornamenti animazione secondo i
   preset qualità.
4. Verificare reset/interruzioni, pedoni e transizioni in gioco. Rag-doll,
   nuove clip e cambi anatomici restano fasi successive, non prerequisiti per
   il primo incremento.

## Verifiche

Questa preparazione non ha lanciato test, build, smoke test, benchmark o
verifiche visive. Eseguire i comandi e i controlli descritti nel brief prima di
considerare A o B chiusi. Non sono state eseguite verifiche per Task C.
