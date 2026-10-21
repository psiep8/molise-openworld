# Life simulator — design e stato reale

Documento di design della modalità vita introdotta nel gioco. Descrive il ciclo
di gioco, il catalogo dei luoghi, l'economia **esclusivamente virtuale**, i
bisogni, i veicoli, la personalizzazione e il salvataggio. Lo stato di ogni
funzione è dichiarato in modo esplicito: se qui c'è scritto "parziale" o
"pianificato", nel gioco non è completo.

> **Regola inderogabile sul denaro.** Gli euro del gioco sono una valuta
> fittizia interna al videogioco. Non sono denaro vero, non hanno valore
> monetario reale e non sono collegati a carte, conti, IBAN, gateway, wallet o
> servizi finanziari reali. Nessun acquisto nel gioco richiede un pagamento
> esterno. Le attività commerciali possono corrispondere a luoghi reali di
> Palata, ma gli acquisti sono **simulati**: il gioco non invia ordini,
> prenotazioni o pagamenti ai locali.

---

## 1. Ciclo di gioco

1. Si parte a piedi dal centro di Palata (o in auto con `?autostart=drive`).
2. Il HUD mostra ora di gioco, bisogni (fame, energia, divertimento) e saldo virtuale.
3. Ci si muove a piedi o si guida l'auto attiva.
4. Avvicinandosi a un'attività compare `Premi E per entrare a …`.
5. `E` apre il pannello attività: stato di verifica, fonte e menu di gioco.
6. Si sceglie un prodotto, si vede costo e saldo residuo, si conferma in
   contanti o col conto virtuale.
7. Fame/energia/divertimento cambiano; l'acquisto finisce nello storico movimenti.
8. Vicino a casa (`E`) si può dormire, riposare un'ora, salvare o aprire il guardaroba.
9. Il tempo avanza (giorno/notte), i bisogni calano, il salvataggio è automatico
   ogni 30 secondi e su ogni acquisto o interazione importante.

## 2. Catalogo luoghi

`src/sim/venue-catalog.ts` è l'unica fonte usata da mappa, minimappa,
interazione e menu.

| Luogo | Categoria | Stato | Note |
| --- | --- | --- | --- |
| Vecchio Frantoio | ristorazione | `needs-review` | pista di ricerca; posizione approssimativa; menu simulato |
| S. Michaelion | punti d'interesse | `needs-review` | pista di ricerca; visita gratuita |
| Bar El Rancho | ristorazione | `needs-review` | pista di ricerca; consumazioni simulate |
| COAL (alimentari) | alimentari | `needs-review` | pista di ricerca; spesa simulata |
| Ricciolotto Abbigliamento | abbigliamento | `needs-review` | pista di ricerca; capi procedurali senza marchi |
| Macelleria Persichillo | alimentari | `needs-review` | pista di ricerca; prezzi simulati |
| Banca / ATM virtuale | servizi | `needs-review` | ATM **simulato**, nessuna banca reale |
| Pizzeria Nuova | ristorazione | `simulated` | attività fittizia per gameplay |
| Parco Centrale | punti d'interesse | `simulated` | luogo fittizio per gameplay |

Campi di ogni voce: id, nome, categoria, coordinate di mondo (offset dal centro
di Palata), stato di verifica, fonte, data di verifica, nota, tipo di edificio,
tipo di interazione, servizi, menu con prezzi in centesimi, colore del marker e
orario di gioco.

**Onestà dei dati:** nessuna voce è `verified`. I nomi derivano dal portale
comunale citato nella specifica e da OpenStreetMap; le coordinate nel gioco sono
approssimate intorno a `START` e i prezzi sono inventati per il gioco. Per
verificare un luogo servono fonte, data e conferma sul campo; solo allora lo
stato può diventare `verified`.

## 3. Economia virtuale

`src/sim/economy.ts`:

- **Interi in centesimi** per evitare errori floating-point.
- **Operazioni pure e atomiche**: le funzioni ricevono un `Wallet` e ne
  restituiscono uno nuovo; un acquisto fallito non modifica saldo né storico.
- **Niente saldi negativi**.
- **Movimenti** con id, importo, tipo, categoria, luogo, descrizione, metodo
  virtuale (`contanti` / `conto` / `carta-simulata`), giorno e ora di gioco,
  saldo prima/dopo.
- **Valori iniziali** configurabili: 500 € virtuali in contanti, 2.000 € sul
  conto virtuale.
- **ATM simulato**: versamento (contanti → conto) e prelievo (conto → contanti)
  conservano il totale.

## 4. Bisogni e orologio

`src/sim/needs.ts`: fame, energia e divertimento (0–100). Calano in proporzione
al tempo di gioco (`NEEDS_DECAY_PER_HOUR`), si modificano con pasti, consumazioni
e attività e si azzerano i rischi con il sonno. Sotto 25 compare un avviso
graduale: nessuna morte improvvisa e nessuna perdita arbitraria di progressi.

L'orologio avanza di 0,5 minuti di gioco per secondo reale e si ferma quando è
aperto un pannello. Dormire porta alle 07:00 del giorno successivo.

## 5. Veicoli

- Catalogo: `src/sim/vehicle-catalog.ts` (22 modelli: 9 preesistenti + 13 richiesti).
- Ogni modello ha id stabile, nome, categoria/stile, **parametri di guida reali**
  (cilindrata, potenza, coppia, masse, 0-100, velocità massima) e una **sagoma
  procedurale originale** (dimensioni, passo, carreggiata, stile carrozzeria).
- I modelli sono selezionabili dal menu `P` o ciclando con `B`, guidabili, con
  collisioni e camera; il colore carrozzeria si cambia dal menu o con `K` ed è
  salvato per veicolo.
- Fedeltà dichiarata: **nessun asset GLB di marca**. Le prestazioni sono reali,
  le forme sono stilizzate e distinguibili (berlina, crossover, SUV, trike).
- Sandbox libera: **non implementata** in questa iterazione (vedi roadmap).

## 6. Casa, garage e interni

- La modalità vita ha **una sola casa** e **una sola auto attiva**.
- La casa è un edificio di Palata scelto automaticamente vicino al centro se non
  ne esiste già uno salvato; si può cambiare con `T` (edificio più vicino).
- In casa (`E`) si dorme, si riposa un'ora, si salva e si apre il guardaroba.
- **Interni camminabili: non implementati.** Le attività e la casa aprono un
  pannello di interazione contestuale: è una scelta dichiarata, non un interno 3D
  esplorabile. Nessuna immagine statica sostituisce l'interazione: acquisti,
  sonno e salvataggi agiscono davvero sullo stato di gioco.

## 7. Personalizzazione

`src/entities/appearance.ts` + pannello impostazioni: sesso, altezza, corporatura,
carnagione, capelli (stile e colore), barba e outfit (casual, elegante, formale,
tuta, campagna, sportivo, hippie) con tre toni. Il negozio di abbigliamento
vende gli stessi outfit implementati e applica subito il cambio visibile. Capi
generici, nessun marchio reale.

## 8. Salvataggi

`src/sim/save.ts` (chiave `molise.life.v1`):

- versione schema esplicita (`SAVE_VERSION`), salvataggio locale;
- convalida al caricamento: se corrotto, il gioco riparte da uno stato sicuro
  senza cancellare il file (la sovrascrittura avviene solo al salvataggio successivo);
- salva denaro virtuale, movimenti, bisogni, giorno/ora, posizione;
- aspetto, veicolo, colore e casa continuano a usare le chiavi `molise.*`
  esistenti, quindi i salvataggi precedenti restano validi;
- autosalvataggio ogni 30 s e su acquisto/interazione; "Nuova partita" azzera
  tutte le chiavi `molise.*` e ricarica la pagina.

## 9. Architettura

| Modulo | Responsabilità |
| --- | --- |
| `sim/economy.ts` | wallet virtuale, acquisti atomici, depositi/prelievi, formattazione |
| `sim/needs.ts` | fame, energia, divertimento, sonno, avvisi |
| `sim/venue-catalog.ts` | luoghi, stato di verifica, servizi, menu |
| `sim/save.ts` | salvataggio versionato e convalidato, orologio di gioco |
| `ui/hud.ts` | HUD, barre bisogni, orologio, portafoglio e storico |
| `ui/minimap.ts` | marker attività su minimappa e mappa grande |
| `game.ts` | interazioni, pannello attività, acquisti, sonno, autosalvataggio |

## 10. Verifica

```bash
npm test          # include tests/economy.test.ts, needs.test.ts, venue-catalog.test.ts, save.test.ts
npm run build     # typecheck + build di produzione
npm run preview   # serve dist/
npm run smoke     # e2e Chrome headless
```

I test coprono la logica deterministica dell'economia (atomicità, fondi
insufficienti, trasferimenti, centesimi interi), i bisogni, la validità del
catalogo luoghi e la convalida dei salvataggi. I percorsi 3D (entrare in
un'attività, guidare ogni modello, dormire) restano da verificare a mano.
