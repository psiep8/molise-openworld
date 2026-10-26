# Roadmap e stato reale delle funzionalità

Ultimo aggiornamento: **26 ottobre 2026**.

Questo documento è la fonte di verità sullo stato delle funzionalità. Legenda:

- **Fatto** — implementato, testato e usato dal gioco.
- **Parziale** — funziona ma con limiti dichiarati (o verificato solo in parte).
- **Pianificato** — non implementato.
- **Da verificare** — implementato ma non ancora provato a mano/end-to-end.

> **Denaro di gioco.** Gli euro del gioco sono una valuta fittizia interna al
> videogioco. Non sono denaro reale, non hanno valore monetario e non sono
> collegati a carte, conti, IBAN, gateway o pagamenti reali. Le attività possono
> corrispondere a luoghi reali di Palata, ma gli acquisti sono **simulati**.

---

## Life simulator

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Portafoglio virtuale (contanti + conto) | **Fatto** | Cloud di valori in centesimi interi, `src/sim/economy.ts`; 500 € / 2.000 € iniziali |
| Acquisti atomici con conferma | **Fatto** | Mostra costo e saldo residuo; nessun saldo negativo; testato |
| Storico movimenti | **Fatto** | Giorno, ora, luogo, categoria, saldo dopo; visibile con `I` |
| ATM simulato (versamento/prelievo) | **Fatto** | Sposta denaro solo tra contanti e conto virtuali |
| Catalogo luoghi data-driven | **Fatto** | `src/sim/venue-catalog.ts`, usato da mappa, minimappa, interazione e menu |
| Stato di verifica dei luoghi | **Fatto** | `needs-review`/`simulated` espliciti; **nessun luogo è `verified`** |
| Menu con effetti sui bisogni | **Fatto** | Prezzi in centesimi, tutti simulati |
| Bisogni (fame, energia, divertimento) | **Fatto** | Calo nel tempo, effetti, avvisi graduali; `src/sim/needs.ts` |
| Orologio giorno/notte | **Fatto** | 0,5 min di gioco al secondo reale; pausa coi pannelli aperti |
| Sonno a casa | **Fatto** | `E` vicino a casa: 07:00 del giorno dopo, energia piena |
| Salvataggio locale versionato | **Fatto** | `molise.life.v1`, convalida, autosalvataggio ogni 30 s |
| Casa unica + auto attiva | **Fatto** | Edificio di Palata scelto automaticamente; cambiabile con `T` |
| Interni 3D camminabili | **Pianificato** | Le attività aprono un pannello contestuale, non un interno 3D |
| Modalità sandbox separata | **Pianificato** | Prove libere di veicoli/outfit senza denaro: da progettare |
| Lavori, corse, eventi giornalieri | **Pianificato** | Nessuna economia di guadagno oltre al saldo iniziale |
| Multiplayer / server | **Pianificato** | Il gioco è offline, single player |

## Veicoli

| Funzionalità | Stato | Note |
| --- | --- | --- |
| 14 modelli in catalogo | **Fatto** | 10 modelli su GLB di serie + 4 carrozzerie del kit; le 21 sagome procedurali sono state eliminate il 26/10 |
| Selezione e guida di ogni modello | **Fatto** | Select popolata dall'intero catalogo; i 6 GLB e i 4 del kit provati in gioco |
| Prestazioni reali (dati tecnici) | **Fatto** | cilindrata, potenza, coppia, 0-100, velocità massima; vedi `docs/VEHICLE_DATA.md` |
| Sagome procedurali originali | **Parziale** | Restano come ripiego se un GLB manca; il catalogo usa i GLB |
| Verifica geometrica dei GLB | **Fatto** | `npm run check:cars`: unità, proporzioni e pezzi staccati senza browser |
| Tinta carrozzeria per modello | **Fatto** | Salvata per id veicolo; `K` o impostazioni |
| Fisica pura testata | **Fatto** | `src/sim/car.ts` + `tests/vehicle-dynamics.test.ts` |

## Mondo, grafica, sistemi

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Terreno/edifici/strade da dati aperti | **Fatto** | OSM + DEM, licenze aperti |
| Autopilota di strada | **Fatto** | `O` in auto: insegue la centerline, anticipa le curve e rallenta agli incroci; `Spazio` lo spegne |
| Spinta (boost) | **Fatto** | `Shift` in auto: +18% aderenza, +25% forza e velocità massima |
| Visuali di guida | **Fatto** | `C`: inseguitrice, alta, cofano; FOV che si apre con la velocità |
| Meteo e ora rapidi | **Fatto** | `Q` meteo successivo, `E` in auto +2 ore |
| Curve stradali a spline | **Fatto** | Catmull-Rom centripeta (`splineThrough`) al posto della media pesata |
| Collisioni dell'auto | **Fatto** | OBB a sei sonde (4 angoli + fianchi), perdita di velocità sulla penetrazione |
| Rollio e beccheggio della carrozzeria | **Da verificare** | `bodyLean()`: ~6° in curva, ±2° in frenata/accelerazione; da guardare a schermo |
| Segnaletica orizzontale | **Fatto** | Stop/dare precedenza a ogni incrocio, frecce, linea di margine, vernice usurata |
| Raccordi d'angolo dei cordoli | **Da verificare** | `filletCorner()`; da guardare a schermo, soprattutto negli incroci a T |
| Spalla in ghiaia e ciglio delle provinciali | **Fatto** | Solo fuori dal paese; stessa quota per la fisica |
| Erba per copertura del suolo | **Da verificare** | Bosco rada/scura, coltivo bassa e gialla, macchia secca; fiori solo nei prati |
| Frecce e fari manuali | **Da verificare** | `,`/`.` frecce a 1,4 Hz, `J` fari diurni; lenti posteriori accese in frenata |
| Cordolo che si sente (scalino 18 cm) | **Fatto** | `curbImpact()`: perdita di velocità e sobbalzo, con test |
| Meteo reale + sole NOAA | **Fatto** | Open-Meteo, fallback locale |
| Qualità scalabile low→ultra | **Fatto** | Preset + resolution scaling adattivo |
| Antialiasing (MSAA 4× + SMAA + unsharp) | **Da verificare** | Target del composer a 2–4 campioni, `alphaToCoverage` su erba/fiori/chiome, ombre PCF morbide |
| Minimappa a scala automatica | **Da verificare** | 320 px, 240–660 m in auto, 300 m a piedi, rotella 0,45×–2,4×, barra di scala |
| Destinazioni fuori area | **Parziale** | Termoli, Larino, Campobasso, Montenero, San Salvo, Vasto: direzione e km sulla minimappa, nessuna geometria 3D |
| Mondo oltre la valle del Biferno | **Pianificato** | Oggi 14 × 12 km: guidare fino a Termoli richiede OSM+DEM del nuovo bbox (vedi HANDOFF) |
| Audio procedurale | **Fatto** | WebAudio, parte dopo un gesto utente |
| Traffico e pedoni | **Pianificato** | — |
| Cache tile offline | **Pianificato** | Solo cache HTTP del browser |
| Mobile | **Pianificato** | Preset `low` come base |

---

## Prossimi passi consigliati

1. **Verifica manuale in Chrome** dei flussi nuovi: entrare in un'attività con `E`,
   comprare (contanti e conto), usare l'ATM, dormire a casa, aprire il portafoglio
   con `I`, e provare su strada i 14 modelli (e un GLB importato dal garage).
2. **Fotografia dei luoghi**: per portare un luogo da `needs-review` a `verified`
   servono fonte, data e conferma della posizione. Finché manca, resta `needs-review`.
3. **Sandbox separato**: modalità di prova libera di tutti i veicoli e gli outfit,
   senza denaro e senza salvataggio della modalità vita.
4. **Interni/luoghi camminabili**: valutare se servono davvero o se il pannello
   contestuale resta la scelta giusta (è più economico e non blocca il gioco).
5. **Economia di guadagno**: lavori/incarichi per guadagnare euro virtuali, così il
   saldo iniziale non è l'unica fonte.
