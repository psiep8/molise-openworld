# Roadmap e stato reale delle funzionalità

Ultimo aggiornamento: **21 ottobre 2026**.

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
| 22 modelli in catalogo | **Fatto** | 9 preesistenti + 13 richiesti |
| Selezione e guida di ogni modello | **Da verificare** | Select popolata dall'intero catalogo; da provare su strada uno per uno |
| Prestazioni reali (dati tecnici) | **Fatto** | cilindrata, potenza, coppia, 0-100, velocità massima; vedi `docs/VEHICLE_DATA.md` |
| Sagome procedurali originali | **Parziale** | Forme stilizzate e distinguibili; **nessun asset GLB di marca** |
| Tinta carrozzeria per modello | **Fatto** | Salvata per id veicolo; `K` o impostazioni |
| Fisica pura testata | **Fatto** | `src/sim/car.ts` + `tests/vehicle-dynamics.test.ts` |

## Mondo, grafica, sistemi

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Terreno/edifici/strade da dati aperti | **Fatto** | OSM + DEM, licenze aperti |
| Meteo reale + sole NOAA | **Fatto** | Open-Meteo, fallback locale |
| Qualità scalabile low→ultra | **Fatto** | Preset + resolution scaling adattivo |
| Audio procedurale | **Fatto** | WebAudio, parte dopo un gesto utente |
| Traffico e pedoni | **Pianificato** | — |
| Cache tile offline | **Pianificato** | Solo cache HTTP del browser |
| Mobile | **Pianificato** | Preset `low` come base |

---

## Prossimi passi consigliati

1. **Verifica manuale in Chrome** dei flussi nuovi: entrare in un'attività con `E`,
   comprare (contanti e conto), usare l'ATM, dormire a casa, aprire il portafoglio
   con `I`, e provare su strada i 22 modelli.
2. **Fotografia dei luoghi**: per portare un luogo da `needs-review` a `verified`
   servono fonte, data e conferma della posizione. Finché manca, resta `needs-review`.
3. **Sandbox separato**: modalità di prova libera di tutti i veicoli e gli outfit,
   senza denaro e senza salvataggio della modalità vita.
4. **Interni/luoghi camminabili**: valutare se servono davvero o se il pannello
   contestuale resta la scelta giusta (è più economico e non blocca il gioco).
5. **Economia di guadagno**: lavori/incarichi per guadagnare euro virtuali, così il
   saldo iniziale non è l'unica fonte.
