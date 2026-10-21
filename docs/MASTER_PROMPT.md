# MASTER PROMPT — SIMULATORE 3D COMPLETO IN THREE.JS

Documento di specifica conservato nel repository. È la fonte delle priorità di
lavoro; lo stato di avanzamento rispetto a ogni punto è in fondo (`Stato attuale`).

## Istruzioni per l'AI che lavorerà sul repository

Agisci come un senior 3D gameplay engineer specializzato in Three.js, WebGL,
simulazione di guida, animazione scheletrica, rendering PBR e architetture
software interattive.

Ispeziona il repository esistente e **implementa** le funzionalità descritte, non
limitarti a proporre un piano o pseudocodice. Preserva ciò che già funziona,
riutilizza l'architettura presente e verifica con build e test disponibili. Non
inventare file, API, asset o risultati di test.

## 1. Obiettivo generale

Simulatore 3D esplorabile con:

- Paesaggio naturale e terreno dettagliato.
- Strade con materiali credibili e rete stradale coerente.
- Erba, alberi, arbusti e vegetazione efficiente.
- Edifici, case, ville e tetti.
- Cielo, illuminazione, ciclo giorno/notte, nebbia e condizioni atmosferiche.
- Pioggia, neve e superfici bagnate o innevate.
- Automobili con modelli e materiali dettagliati.
- Personaggio umano 3D personalizzabile, animazioni e movimento a piedi.
- Entrata e uscita dalle automobili.
- Garage e configuratore in gioco.
- Nove tipologie di veicoli.
- Personalizzazione estetica e meccanica.
- Interfaccia e controlli coerenti.
- Salvataggio delle configurazioni.
- Prestazioni adeguate e fallback per asset mancanti.

Il risultato deve essere un sistema integrato, non demo scollegate.

## 2. Prima fase obbligatoria: ispeziona il progetto

1. Struttura del repository, `package.json`, dipendenze, script, entry point, renderer.
2. Classe `Vehicle`, controller, fisica, collisioni, terreno, strade, edifici, camera, input, UI.
3. Verifica delle API presenti: `stepCar`, `Heightfield`, `RoadIndex`, `BuildingIndex`, `WORLD`.
4. Asset disponibili: formati, licenze, struttura.
5. Build e test esistenti per lo stato iniziale.
6. Piano per fasi, poi esecuzione.

Non riscrivere l'intero progetto se basta estenderlo. Rispetta la versione di
Three.js installata.

## 3. Regole architetturali

- Separare rendering, simulazione, input, collisioni, dati, interfaccia.
- Riutilizzare i moduli adeguati.
- Nessuna duplicazione del codice di guida per modello.
- Nessuna dipendenza pesante senza necessità.
- Moduli e tipi coerenti con il linguaggio del repository.
- Errori di caricamento asset non bloccanti.
- Nessun pulsante fittizio: ogni controllo deve avere effetto.
- Nessuna funzione dichiarata completa se non implementata o non verificata.
- Fallback espliciti e documentati.
- Progetto avviabile a ogni fase.

## 4. Paesaggio e terreno

Pianure, colline, dislivelli, pendenze graduali; materiali distinti per erba,
terra, roccia, sabbia, asfalto; UV corretti; dettaglio a distanza; collisioni
coerenti con la superficie visibile; vegetazione, edifici e strade posizionati
correttamente; nessuna compenetrazione evidente.

Se esiste `Heightfield`, resta la fonte di verità per altezza e pendenza.

## 5. Erba, alberi e vegetazione

Erba corta e alta, prati, arbusti, alberi di forme e dimensioni diverse,
vegetazione stradale e collinare. Distribuzione che consideri terreno, pendenza,
strade, edifici. Niente alberi in carreggiata o dentro le case.

Preferire `InstancedMesh`, atlanti, casualità deterministica, densità
configurabile e modalità qualità ridotta.

## 6. Strade e superfici

Strade principali e secondarie, curve morbide, incroci, bordi, linee centrali e
laterali, marciapiedi urbani, piazzali, accessi; materiali per asfalto nuovo,
usurato e sterrato; segnaletica essenziale. Evitare salti, compenetrazioni e
disallineamenti. Le ruote restano in contatto con la superficie.

Se esiste `RoadIndex`, estenderlo, non duplicarlo.

## 7. Edifici, case, ville e tetti

Case piccole e medie, ville, edifici a più piani, facciate e materiali diversi,
tetti piani e inclinati, tegole credibili, finestre, porte, balconi, persiane,
grondaie, recinzioni, cancelli, vialetti, garage, cortili, parcheggi,
marciapiedi, arredo urbano.

Moduli riutilizzabili e varianti procedurali; proporzioni credibili; collisioni
efficienti (non ogni dettaglio decorativo è un collider). Se esiste
`BuildingIndex`, integrarlo.

## 8. Cielo, luce, giorno/notte e atmosfera

Cielo credibile, sole e luce ambientale, ombre coerenti, nebbia configurabile,
illuminazione diurna e notturna, transizioni graduali alba/giorno/tramonto/notte,
fari dei veicoli, illuminazione stradale ed edifici, esposizione e contrasto
controllati.

Materiali PBR quando appropriato. Non introdurre sistemi di illuminazione o
post-processing che si contraddicono.

La transizione giorno/notte deve aggiornare davvero direzione e intensità della
luce, cielo, illuminazione artificiale e visibilità.

## 9. Pioggia, neve e superfici meteorologiche

**Pioggia**: particelle efficienti, intensità regolabile, foschia coerente,
superfici stradali più lucide, effetti che non ostacolino la guida.

**Neve**: fiocchi con velocità e traiettorie plausibili, intensità regolabile,
aspetto innevato dove implementabile, materiali coerenti, aderenza modificata
solo se integrata nella simulazione.

**Sistema meteo**: sereno, nuvoloso, pioggia, neve; parametri configurabili;
cambio durante il gioco; nessuna perdita progressiva di prestazioni.

Non applicare effetti fisici non implementati.

## 10. Materiali, texture e illuminazione

Asfalto, terra, erba, roccia, calcestruzzo, mattoni, intonaco, tegole, vetro,
metallo, gomma, vernice auto, tessuti e pelle. Texture con licenza compatibile o
materiali procedurali. Colore, roughness, metalness, normali, UV corretti.
Evitare texture stirate, ripetizioni evidenti, lucidità ingiustificata,
materiali neri per illuminazione errata.

## 11. Asset 3D e modelli esterni

GLB/glTF quando disponibili, compatibili e legalmente utilizzabili. Riferimenti
tecnici: <https://threejs.org/examples/> (car, gltf, sky, texture, instancing,
postprocessing, ocean, points). Nessun file copiato senza licenza verificata.
Documentare origine e licenza.

## 12. Veicolo esistente: preservare la simulazione

Mantenere separate: stato fisico, input, modello grafico, geometria di
collisione, parametri del veicolo, personalizzazioni.

Se esistono `stepCar`, `Heightfield`, `RoadIndex`, `BuildingIndex`, `WORLD`,
verificarne il funzionamento e mantenere compatibilità. Il modello grafico può
essere sostituito, ma resta collegato allo stato fisico. Ruote coerenti con
sterzata, rotazione, posizione e sospensioni.

Non inventare fisica realistica completa: estendere in modo incrementale,
testabile e stabile.

# PARTE A — PERSONAGGIO UMANO 3D

## 13. Modello umano dettagliato

Testa, cranio, fronte, mandibola, mento, orecchie, occhi con iridi e pupille,
palpebre, sopracciglia, naso, bocca, guance, zigomi, collo, torso, bacino,
spalle, braccia, gomiti, avambracci, polsi, mani, gambe, ginocchia, polpacci,
caviglie, piedi, capelli, materiali separati per pelle, capelli, occhi, vestiti,
scarpe.

Non rappresentare il personaggio come sfere e cilindri evidenti. Preferire un
modello riggato GLB/glTF con UV, PBR e scheletro; altrimenti fallback procedurale
sostituibile, dichiarato come tale.

## 14. Personalizzazione del volto

Configuratore con anteprima in tempo reale: forma del viso, larghezza e altezza,
mandibola e mento, occhi (dimensione, forma, posizione, distanza), sopracciglia,
naso, bocca, labbra, guance, tonalità pelle, colore occhi, capelli (colore e
stile), barba e baffi, occhiali e accessori.

Morph target/blend shape o deformazioni reali quando disponibili. Controlli non
supportati vanno disabilitati. Evitare deformazioni innaturali e intersezioni.

## 15. Personalizzazione del corpo e abbigliamento

Altezza, corporatura, larghezza spalle, volume torso, proporzioni arti entro
limiti plausibili, tono muscolare se supportato, tonalità pelle, abbigliamento,
scarpe, accessori. Outfit modulari. Nessuna duplicazione inutile di scheletro o
risorse.

## 16. Animazioni del personaggio

`AnimationMixer` e clip compatibili con la versione installata: idle, camminata
lenta e veloce, corsa e sprint, salto verticale e in avanti, atterraggio,
accovacciamento, rialzarsi, rotazione del corpo, avvio e arresto, entrata e
uscita dal veicolo, posizione seduta, gesti se supportati.

Blending graduale, movimento sincronizzato con la velocità effettiva.

## 17. Movimento a piedi, fisica e telecamera

Avanti, indietro, laterale, rotazione, camminata, corsa, sprint, salto; gravità,
velocità verticale, collisioni con terreno e ostacoli, rilevamento terreno,
atterraggio, pendenze, prevenzione compenetrazione, blocco salto ripetuto in aria.

Telecamera terza persona fluida, orientabile, distanza regolabile, collisioni con
ostacoli. Mantenere la camera di guida. Nessun conflitto di comandi. Supporto
controller/touchscreen se presenti.

## 18. Entrata e uscita dalle automobili

Avvicinarsi, interagire con un punto d'ingresso, entrare, guidare, scendere.
Stati espliciti (`onFoot`, `enteringVehicle`, `driving`, `exitingVehicle`) o
equivalenti. Durante entrata/uscita disattivare il controllo corretto, cercare un
punto sicuro, non uscire dentro muri o terreno, sincronizzare posizione,
animazioni, camera.

## 19. Salvataggio del personaggio

Salvare parametri serializzabili: volto, corpo, capelli, colori, outfit,
accessori, preferenze. Integrare il salvataggio esistente o crearne uno locale
versionato con validazione. Non serializzare oggetti Three.js.

# PARTE B — CATALOGO AUTOMOBILISTICO

## 20. Nove tipologie obbligatorie

1. Fiat Panda vecchia — piccola, compatta, squadrata.
2. Fiat Panda nuova — utilitaria moderna.
3. Fiat Punto — utilitaria con sagoma e frontale distinti.
4. Jeep Renegade — SUV compatto squadrato.
5. Veicolo a tre ruote — configurazione dedicata.
6. Fiat 500X — crossover compatto.
7. Renault Captur — crossover urbano.
8. Citroën C3 — utilitaria con proporzioni specifiche.
9. Alfa Romeo Junior — crossover compatto distintivo.

Tutte e nove devono essere presenti in catalogo.

## 21. Modelli 3D e licenze

Preferire GLB/glTF completi e legalmente utilizzabili, con licenza verificata.
Altrimenti ricostruzione procedurale originale con silhouette, proporzioni,
frontale, fari, linea del tetto e dettagli distintivi. Non affermare che una
ricostruzione è un modello ufficiale. Fallback funzionante per ogni veicolo.

Componenti identificabili: carrozzeria, vetri, ruote, cerchi, fari, fanali,
paraurti, accessori. Pivot per le ruote.

## 22. Parametri specifici dei veicoli

Lunghezza, larghezza, altezza, passo, carreggiata, raggio ruote, massa,
accelerazione, velocità massima, frenata, sterzata massima e risposta, aderenza,
sospensioni, trazione se supportata.

Valori iniziali plausibili, stime di gioco distinte dalle specifiche verificate.
Collisioni coerenti con le dimensioni del veicolo scelto.

## 23. Controller unificato

Interfaccia comune per tutti i veicoli, nessuna duplicazione della classe
`Vehicle`. Separare dati, modello grafico, parametri, componenti, stato.

Compatibilità con `CarState`, `CarInput`, `stepCar`, `Heightfield`,
`RoadIndex`, `BuildingIndex`, `WORLD`. Ruote coerenti. Il tre ruote ha
configurazione dedicata, non è un'auto a cui manca una ruota.

## 24. Selezione dei veicoli

Schermata con nome, anteprima 3D, rotazione, colori, caratteristiche, dimensioni,
pulsante di selezione e accesso al garage. Anteprima isolata dalla simulazione.
Selezione che aggiorna davvero il veicolo in uso. Fallback e messaggio
diagnostico in caso di errore.

# PARTE C — GARAGE E PERSONALIZZAZIONE DELLE AUTO

## 25. Garage interattivo

Selezionare veicolo, ispezionarlo da più angolazioni, cambiare colore e finitura,
cerchi e pneumatici, assetto e altezza da terra entro limiti plausibili,
aggiungere o rimuovere accessori, cambiare fari e fanali se possibile, modificare
prestazioni, salvare configurazioni multiple, ripristinare la configurazione
originale. Modifiche visibili in tempo reale, non opzioni decorative.

## 26. Personalizzazione estetica

Colore carrozzeria, colore secondario o tetto, cerchi, finitura metallizzata /
opaca / lucida, colore pinze freno, tinta vetri, barre e portapacchi, paraurti e
protezioni, adesivi e livree, dettagli interni, accessori compatibili.

La verniciatura deve modificare i materiali corretti, non vetri, pneumatici e
fari. Parti identificate tramite metadati, nomi dei nodi o manifest esplicito.

## 27. Personalizzazione meccanica

Potenza o livello motore, accelerazione, frenata, sospensioni, altezza da terra,
pneumatici stradali/misti/da sterrato, aderenza, rapporti se supportati, massa
aggiuntiva. Le modifiche devono influenzare i parametri reali della simulazione.

## 28. Componenti modulari

Paraurti, griglia, spoiler, barre sul tetto, protezioni, fari ausiliari,
specchietti, cerchi e decorazioni, con punti di montaggio compatibili. Ripristino
di fabbrica sempre possibile.

## 29. Dati e salvataggio delle configurazioni

Modello dati versionato, ad esempio:

```ts
interface VehicleCustomization {
  vehicleId: string;
  paintColor: string;
  secondaryColor?: string;
  wheelId?: string;
  tireType?: string;
  suspensionHeight?: number;
  performanceLevel?: number;
  accessoryIds: string[];
}
```

Salvataggio locale, più configurazioni per veicolo, ripristino, validazione,
migrazione. Niente istanze Three.js serializzate.

# PARTE D — INTERFACCIA, PRESTAZIONI E VERIFICA

## 30. Interfaccia utente

Pannelli per: selezione personaggio, volto, corpo, abbigliamento, prova
animazioni, selezione auto, garage, impostazioni di guida, salvataggio e
caricamento. Controlli chiari, anteprime, feedback immediato, nessun controllo
fittizio. Durante la guida i pannelli devono essere chiusi o inattivi.

## 31. Prestazioni

Riutilizzo di geometrie, materiali e texture; `InstancedMesh` per elementi
ripetuti; caricamento su richiesta; limite agli aggiornamenti di oggetti lontani;
rilascio corretto delle risorse; collisioni semplici; nessuna creazione continua
di particelle; qualità configurabile e fallback per dispositivi deboli.

## 32. Test e criteri di accettazione

**Ambiente**: terreno visibile e fisico coerenti; niente compenetrazioni evidenti
tra strade, edifici e vegetazione; giorno/notte e meteo con effetti reali;
prestazioni accettabili con densità configurabile.

**Personaggio**: cammina, corre, salta; gravità e collisioni; animazioni senza
scatti; parametri del volto con effetti reali; personalizzazione valida; segue il
terreno; entra ed esce dall'auto in sicurezza; configurazione salvabile.

**Automobili**: nove tipologie selezionabili; modello o fallback specifico;
dimensioni e pivot coerenti; ruote corrette; selezione efficace; parametri del
veicolo corretto; tre ruote dedicato.

**Garage**: modifiche estetiche visibili; modifiche meccaniche reali; ripristino
di fabbrica; salvataggio e ricarica; errori non bloccanti.

Eseguire build e test. Se disponibile un browser, verificare anche il
comportamento visivo. Distinguere ciò che è stato testato da ciò che non lo è.

## 33. Ordine di implementazione suggerito

1. Analisi e build iniziale.
2. Consolidamento architettura e asset.
3. Terreno, strade, edifici, vegetazione.
4. Materiali, cielo, illuminazione, meteo.
5. Sistema unificato veicoli e catalogo.
6. Garage e personalizzazione estetica.
7. Personalizzazione meccanica collegata alla simulazione.
8. Personaggio, rig e animazioni.
9. Movimento a piedi, camera, collisioni.
10. Entrata e uscita dalle auto.
11. Salvataggio configurazioni.
12. Ottimizzazione, test, correzioni, documentazione.

## 34. Consegna finale

Implementazione integrata; file creati e modificati; asset con provenienza e
licenza; istruzioni di avvio; uso del personaggio e personalizzazione; istruzioni
per entrare e uscire dalle auto; catalogo completo delle nove tipologie;
istruzioni del garage; personalizzazioni disponibili; risultati di build e test;
limiti residui. Nessun pulsante fittizio. Nessuna verifica dichiarata senza
essere stata eseguita.

**Priorità assoluta: preservare la simulazione esistente, implementare
funzionalità reali, mantenere il progetto avviabile e verificare ogni fase.**

---

## Stato attuale nel repository

Legenda: ✅ implementato · 🟡 parziale · ⬜ non iniziato

| Area | Stato | Note |
| --- | --- | --- |
| Terreno e DEM coerenti | ✅ | `Terrain` + `Heightfield`, normal map dal DEM, `roughnessMap` procedurale |
| Strade e superfici | 🟡 | Rete OSM, asfalto/sterrato, bagnato dinamico; niente segnaletica dipinta |
| Vegetazione | 🟡 | Alberi e uliveti a istanze + campo d'erba a istanze; niente vento animato |
| Edifici | 🟡 | Estrusione OSM con texture facciata/coppi; niente balconi o grondaie |
| Cielo e giorno/notte | ✅ | Sky shader + ora manuale 0–24 con slider e preset meteo |
| Meteo reale | ✅ | Open-Meteo, refresh 10 min, sole NOAA locale, fallback offline |
| Pioggia / neve | ✅ | Particelle riutilizzate, foschia e strada bagnata |
| Fari notturni | ✅ | Due spot sul veicolo, lampade emissive |
| Veicoli | ✅ | **22 veicoli** procedurali con dati di fabbrica reali per motore, coppia, 0-100 e velocità massima (9 preesistenti + 13 richiesti; `src/sim/vehicle-catalog.ts`, fonti in `docs/VEHICLE_DATA.md`). Sagome procedurali originali, **nessun asset GLB di marca** |
| Cambio e freni | ✅ | Cambio automatico 5/6 marce con strappo e kickdown, curva coppia/potenza, pattinamento in partenza, frenata 8,8–10,2 m/s², retromarcia; HUD con marcia e giri |
| Garage / personalizzazione | ✅ | Casa scelta sulle impronte OSM con segnalibro in mappa (`T`/menu, `L` per tornarci), auto parcheggiata lì, cambio veicolo e 10 tinte per veicolo |
| Personaggio | ✅ | Rig procedurale con ossa, 3 clip base + 2 additive; sesso, altezza, corporatura, carnagione, capelli, barba e 7 outfit con 3 toni, ricostruiti a runtime |
| Entrata/uscita auto | ✅ | Tasto `F`, punto di discesa validato sui muri |
| Salvataggi | ✅ | Veicolo, tinta, aspetto del personaggio, casa/garage e meteo in `localStorage`; modalità vita in `molise.life.v1` (`src/sim/save.ts`), versionata e convalidata |
| Economia virtuale | ✅ | **Solo euro di gioco**: contanti + conto virtuale, acquisti atomici con conferma, storico movimenti, ATM simulato (`src/sim/economy.ts`). Nessun pagamento reale |
| Luoghi e attività | 🟡 | Catalogo data-driven usato da mappa, minimappa, interazione e menu (`src/sim/venue-catalog.ts`); stato di verifica esplicito, **nessun luogo `verified`**, prezzi simulati |
| Bisogni e orologio | ✅ | Fame/energia/divertimento con calo nel tempo, avvisi graduali, sonno a casa, giorno/notte (`src/sim/needs.ts`) |
| Interni 3D | ⬜ | Le attività e la casa usano un pannello contestuale, non un interno camminabile |
| Sandbox libero | ⬜ | Prove veicoli/outfit senza denaro: da progettare (vedi `docs/ROADMAP.md`) |
| Stereo | ✅ | Side-by-side con tasto `Y` |
| Test | ✅ | Vitest su fisica, sole, meteo, geometria, routing, economia, bisogni, catalogo luoghi e salvataggio |
