# Molise Open World — Piano di realismo per lo sviluppo

> **Documento di lavoro, aggiornato man mano.** Brief del proprietario del progetto,
> tenuto nel repo come riferimento unico per il lavoro sulla grafica. La sezione
> [Registro di avanzamento](#registro-di-avanzamento) in fondo è la fonte di verità
> su cosa è stato fatto e cosa resta: va aggiornata **a ogni blocco di lavoro**.
>
> Nel registro si scrive solo ciò che è stato **visto funzionare** (build, test,
> prova in browser). Se una cosa è nel codice ma non è stata provata, va marcata
> `da verificare`.

Oct 22, 2026 · @Giuseppe

## Priorità del 23/10/2026 (dette dall'utente, in ordine)

Queste vengono prima di tutto il resto. Sono i difetti che si vedono subito
all'avvio e che fanno sembrare il gioco finto.

1. **Paesaggio in lontananza definito.** All'ingresso non si devono vedere
   campi, terreni e boschi sfocati "in 144p": il terreno lontano deve avere
   texture vera, non una macchia verde. (importantissimo)
2. **Edifici abbastanza alti.** Ci sono case di un piano con il portone
   interrato: le altezze vanno alzate a misura di casa vera. (importantissimo)
3. **Edifici in salita.** Oggi restano orizzontali e bucati sotto: devono
   appoggiarsi alla pendenza, senza vuoti sotto i muri.
4. **Pendenza reale delle strade.** La strada deve seguire il rilievo come
   sulla mappa, non essere un nastro appoggiato.
5. **Strade, marciapiedi e asfalto allineati.** Camminare non deve sembrare di
   affondare nella sabbia; incroci e segnaletica (verticale e orizzontale) da
   sistemare; niente panchine messe a caso. (importantissimo)
6. **Guida credibile.** Una Panda vecchia non fa 0–100 in un secondo: meno
   accelerazione e sterzo meno nervoso.
7. **Console pulita.** `THREE.Clock` deprecato (usare `THREE.Timer`) e
   `Texture marked for update but no image data found`.

Questo documento è un brief da dare a un assistente AI di sviluppo che lavora sul repo `psiep8/molise-openworld` (TypeScript, Vite, three.js 0.186): porta strade, vegetazione, paesaggio lontano, edifici, veicoli e personaggio al massimo livello di dettaglio realistico che un gioco nel browser può permettersi.

## Obiettivo e vincoli

**Obiettivo.** Un mondo aperto che da vicino si legge come un posto vero (asfalto consumato, alberi con volume, auto con riflessi) e da lontano come un paesaggio molisano (colline, campi, foschia), senza sembrare fatto di blocchi.

**Cosa è realistico aspettarsi.** Livello "bel gioco indie curato", non GTA V. Gli edifici nascono da impronte OpenStreetMap, quindi i modelli fatti a mano si usano solo per pochi punti d'interesse.

**Vincoli non negoziabili**

1. **Licenze.** Ogni asset esterno deve avere licenza che ne consenta l'uso nel progetto, registrata in `public/models/ATTRIBUTION.md` o `public/textures/ATTRIBUTION.md`. Nessun asset, codice o dato di GTA V / Rockstar. Nessun modello con marchi reali (stemmi, loghi, nomi).
2. **Fallback sempre.** Se un file manca o non si carica, il gioco usa la versione procedurale attuale e non va in errore.
3. **Prestazioni scalabili.** Ogni novità si accende per preset (`low`, `medium`, `high`, `ultra` in `src/gfx/quality.ts`). Il preset `low` deve restare giocabile su un PC modesto.
4. **Determinismo.** Stesso seed, stesso paesaggio (si usa `mulberry32` in `src/geo/geo.ts`).
5. **Non rompere ciò che c'è.** `npm test`, `npm run build` e `npm run smoke` devono restare verdi.

## Stato attuale (letto dal repo, 22 ottobre 2026)

Il salto da "Minecraft" è già avvenuto su terreno, strade, edifici e vegetazione; i veicoli sono ancora il punto più semplice, perché `src/entities/vehicle.ts` costruisce le auto con `RoundedBoxGeometry` e `BoxGeometry` e non carica nessun modello 3D.

| Area | Cosa c'è ora | Cosa manca |
| --- | --- | --- |
| Terreno | Chunk da 912 m, DEM a 10 m, mosaico Sentinel-2 locale per ogni chunk, tile Esri z18/z17/z16 a distanza progressiva, normal map dal rilievo, dettaglio erba/roccia in coordinate mondo | Orizzonte oltre i ~3 km, dettaglio calibrato sul tipo di suolo |
| Strade | Asfalto PBR (Poly Haven `asphalt_02`), mezzeria, marciapiedi e cordoli, angoli smussati | Usura, rattoppi, tombini, segnaletica orizzontale completa, bagnato realistico |
| Edifici | Estrusioni OSM, tetti a falde, cornicioni, comignoli, pluviali, balconi, finestre con cornice/davanzale/vetro | Varietà di facciate, interni finti nelle finestre di notte, edifici-simbolo modellati |
| Alberi | Tronchi con corteccia PBR, chiome a card fotografiche con vento, max 7000 | Modelli 3D veri da vicino, specie diverse (ulivo, quercia, cipresso) |
| Prati | Ciuffi istanziati con texture alpha e vento | Varietà di specie, fiori, erba alta nei campi |
| Acqua | Normali scorrevoli, materiale fisico | Schiuma a riva, riflessi del cielo reali |
| Veicoli | 22 modelli con dati tecnici reali, forme procedurali arrotondate | Modelli GLB, ruote vere, vetri, interni, luci dei freni |
| Personaggio | Avatar Ready Player Me con scheletro, clip idle/walk/run, outfit, pedoni in giro per il paese | Materiali pelle e capelli più curati, fusione tra camminata e corsa, piedi che seguono il terreno |
| Luce | Sole NOAA, cielo `Sky`, IBL dal cielo, ombre, bloom, SSAO, SMAA | Ombre a cascata, color grading, nebbia d'altezza |

**File da conoscere:** `src/world/{terrain,roads,buildings,vegetation,grass,sky,street-furniture,pedestrians}.ts`, `src/entities/{vehicle,player,human-model,appearance}.ts`, `src/gfx/{post,quality,textures,wind}.ts`, `src/sim/vehicle-catalog.ts`, `scripts/fetch-textures.mjs`, `HANDOFF.md`.

## Principi tecnici per tutto il lavoro

Il dettaglio si ottiene dando più qualità a ciò che sta vicino alla camera e meno a ciò che sta lontano, senza che il passaggio si noti.

1. **LOD a tre fasce.** Vicino (0–40 m): geometria e texture complete. Medio (40–300 m): geometria semplificata, texture a risoluzione ridotta. Lontano (oltre 300 m): card, colore unito o texture del terreno. Le soglie vanno in `src/config.ts`, non sparse nel codice.
2. **Istanze per tutto ciò che si ripete.** Alberi, erba, lampioni, pali, auto del traffico: `InstancedMesh`, una draw call per tipo. Esempi three.js di riferimento: `webgl_instancing_scatter`, `webgl_buffergeometry_instancing_billboards`, `webgl_loader_gltf_instancing`.
3. **Texture compresse.** Dopo che una texture funziona in JPG, convertirla in KTX2/Basis con `KTX2Loader` (`webgl_loader_texture_ktx2`): meno VRAM e caricamento più rapido. Anisotropia al massimo supportato dalla GPU.
4. **Modelli compressi.** GLB con compressione Meshopt o Draco (`webgl_loader_gltf_compressed`). Un'auto vicina resta sotto ~60 mila triangoli, una lontana sotto ~5 mila.
5. **Budget da misurare, non da assumere.** Prima di ogni fase registrare fps, numero di draw call (`renderer.info.render.calls`) e triangoli (`renderer.info.render.triangles`) nelle stesse tre posizioni di prova: piazza di Palata a piedi, strada di campagna in auto, collina con vista aperta. Dopo la fase, nessun preset deve perdere più del 15% di fps rispetto a prima, salvo accordo esplicito.
6. **Caricamento in streaming.** Nessun modello o texture pesante blocca l'avvio: si carica in background e si sostituisce il segnaposto procedurale a caricamento finito.
7. **Colore e spazio colore.** Le texture di colore sono `SRGBColorSpace`, le altre (normal, roughness, AO) restano lineari. Un errore qui dà il tipico aspetto slavato.

## Strade e marciapiedi

La strada è ciò che il giocatore guarda di più, quindi l'asfalto deve sembrare usato: non un colore uniforme con una texture sopra.

**Da fare, in ordine di resa**

1. **Usura a canali.** Sul nastro stradale (`pushRibbon` in `src/world/roads.ts`) usare le UV già presenti: `u` attraversa la carreggiata, `v` scorre lungo la strada. Nello shader (`onBeforeCompile`) scurire e lisciare due bande al 30% e al 70% di `u` (le tracce delle ruote), schiarire il centro e i bordi.
2. **Variazione a grande scala.** Moltiplicare il colore per una texture di rumore campionata in coordinate mondo a bassa frequenza (una macchia ogni 20–50 m), per rompere la ripetizione dell'asfalto.
3. **Rattoppi e crepe.** Decal (`DecalGeometry` o quad con `polygonOffset`) di toppe d'asfalto più scure e di crepe lineari, istanziati lungo le strade con seed deterministico, più fitti sulle strade secondarie.
4. **Segnaletica.** Linee di mezzeria continue e tratteggiate, linee di margine, strisce pedonali agli incroci e davanti ai luoghi del catalogo; frecce e "STOP" solo agli incroci principali. Texture con alpha, consumata dallo stesso rumore dell'usura.
5. **Bordo strada.** Fascia di ghiaia e terra di 30–80 cm tra asfalto e prato (materiale `gravel` già in `public/textures/gravel`), con erba che sconfina a ciuffi. Niente taglio netto.
6. **Arredo.** Tombini, caditoie, pali della luce e della segnaletica, guardrail nelle curve su pendio, cartelli stradali veri (limite, curva, indicazione Palata). `src/world/street-furniture.ts` esiste: estenderlo con `InstancedMesh`.
7. **Muretti a secco e recinzioni** ai bordi dei campi e delle strade di campagna: il tratto più riconoscibile del paesaggio molisano.
8. **Bagnato.** Con pioggia: abbassare la roughness dell'asfalto verso 0.25, scurire il colore del 20–30%, aggiungere pozzanghere con una maschera a rumore e riflesso del cielo tramite `scene.environment`. Strada asciutta dopo 2–3 minuti di gioco senza pioggia.
9. **Segni di frenata** e polvere sulle strade sterrate al passaggio dell'auto (particelle leggere, max poche decine).

**Criteri di accettazione**

- Da 2 m di altezza, nessuna ripetizione visibile dell'asfalto su 30 m di strada.
- Le strisce pedonali compaiono solo dove la strada incontra un luogo del catalogo o un incrocio principale, mai in mezzo alla campagna.
- Con pioggia, il riflesso del cielo si vede sull'asfalto a camera bassa; con sole, la strada torna opaca.

## Alberi, vegetazione e prati

Oggi gli alberi hanno tronco con corteccia PBR e chiome a card fotografiche con vento (`src/world/vegetation.ts`, max 7000). Da vicino la chioma resta piatta: serve geometria vera.

**Da fare**

1. **LOD in tre livelli per ogni albero.** Vicino (sotto 35 m): modello GLB con rami e foglie a card (30–40 mila triangoli al massimo). Medio (35–200 m): stessa chioma con meno card. Lontano (oltre 200 m): una o due card incrociate o un billboard orientato verso la camera. Il cambio avviene per `InstancedMesh` separate per livello, ricalcolate quando il giocatore si sposta di oltre 20 m, non a ogni frame.
2. **Specie vere del Molise.** Ulivo (uliveti: le aree OSM `orchard` esistono già), roverella e quercia (boschi), cipresso (viali e cimiteri), pino d'Aleppo e salice lungo i torrenti, pioppo nei campi. La specie si sceglie dal tipo di area OSM e dall'altitudine, con seed deterministico.
3. **Variazione per istanza.** Scala 0.7–1.4, rotazione, leggera inclinazione, tinta delle foglie (`setColorAt`) e fase del vento diversa per ogni albero.
4. **Foglie.** Texture con `alphaMap` e `alphaToCoverage: true` con MSAA, o `alphaTest` e SMAA; ombre con `customDepthMaterial` che usi la stessa alpha, altrimenti le ombre sono rettangoli pieni.
5. **Vento.** Spostamento dei vertici nello shader, con ampiezza crescente verso la cima e verso l'estremità dei rami (colore vertice come maschera), più una raffica lenta che segue la direzione e la velocità del vento reale già letta da `weather.ts`.
6. **Sottobosco.** Cespugli, felci, rovi e sassi istanziati dentro i boschi e ai bordi; foglie e rami caduti come decal sul terreno.
7. **Prati.** Più tipi di ciuffo (erba verde, erba secca, fiori selvatici) mescolati per un campo di colore leggendo il tipo di terreno: giallo a fine estate, verde in primavera; erba più alta e fitta nei campi, corta lungo le strade.
8. **Colture.** Filari di vigneto e di grano come texture tileable sul terreno e, vicino alla camera, righe di istanze. L'OSM ha `farmland` e `vineyard`: usarli.

**Fonti di modelli** (verificare la licenza di ogni file prima di inserirlo): Quaternius "Ultimate Nature" e Kenney "Nature Kit" (entrambi CC0), Poly Haven per le texture, il generatore open source di alberi per three.js `ez-tree` (licenza da verificare sul repo) per ottenere varietà di querce e ulivi senza modellarli.

**Criteri di accettazione**

- A 10 m, un albero ha rami e foglie separate, non una palla.
- Il passaggio tra livelli LOD non produce "scatti" visibili camminando verso un bosco (si può usare un cross-fade con dithering).
- Con `low`, gli alberi vicini restano sotto 40 per fotogramma.

## Paesaggio in lontananza

Oggi il terreno si carica per un raggio di circa 3,1 km e il mondo giocabile misura circa 14 × 12 km. Oltre, la scena finisce nella nebbia: è il punto dove un orizzonte credibile cambia di più l'impressione generale.

**Da fare**

1. **Anello d'orizzonte.** Una mesh a bassa risoluzione che circonda il mondo fino a 40–60 km, ricavata dagli stessi tile DEM Terrarium già usati (`scripts/fetch-geodata.mjs`) a zoom 9–10, con la texture satellite a zoom 8–9. Costa pochi mila triangoli e dà colline e crinali veri sullo sfondo (l'Appennino, la costa verso Termoli). Non è giocabile: nessuna collisione.
2. **Prospettiva atmosferica.** Più un oggetto è lontano, più deve tendere al colore del cielo e perdere contrasto. Sostituire `THREE.Fog` lineare con nebbia esponenziale e con colore ricavato dal cielo vicino all'orizzonte; aggiungere una componente d'altezza (più densa nelle valli, `webgpu_fog_height` mostra l'idea) per la foschia mattutina nei fondovalle.
3. **Colore del suolo da OSM.** Moltiplicare il satellite per una mappa a bassa risoluzione dei tipi di suolo (bosco, uliveto, seminativo, vigneto, urbano): dà macchie di colore leggibili anche dove il satellite è a z15.
4. **Texture di dettaglio sfumate.** La texture erba/roccia tileable deve svanire con la distanza (da 80 a 250 m) per non mostrare la ripetizione a scacchiera.
5. **Alberi lontani come massa.** Oltre i 600 m niente istanze: bosco come texture scura con rumore, più fasce di card basse lungo i bordi dei boschi per dare un profilo irregolare.
6. **Paesi in lontananza.** Edifici oltre 800 m uniti in una sola mesh per tile, con colore unito e tetto rosso; niente finestre. Di notte, punti luminosi emissivi per le finestre accese, che sono l'effetto più riconoscibile di un paese visto da lontano.
7. **Ombre di nuvole.** Una texture di rumore in movimento che scurisce il terreno a chiazze, seguendo la copertura nuvolosa reale già letta dal meteo.
8. **Ombre a cascata (CSM).** `three/addons/csm/CSM.js` (`webgl_shadowmap_csm`) al posto di una sola ombra: ombre nitide vicino alla camera e morbide fino a 400–600 m.

**Criteri di accettazione**

- Da una collina, a 360° non si vede mai un bordo del mondo o un taglio netto del terreno.
- Tre fasce di profondità distinguibili a occhio: primo piano nitido, colline medie più chiare, sfondo azzurrato.
- Di notte, i paesi vicini si riconoscono dalle luci.

## Edifici e paese

Gli edifici (`src/world/buildings.ts`) hanno già tetti a falde, cornicioni, comignoli, pluviali, balconi e finestre incassate. Quello che tradisce l'origine automatica è la somiglianza tra un edificio e l'altro.

**Da fare**

1. **Famiglie di facciata.** Cinque o sei materiali PBR (intonaco chiaro, intonaco ocra, intonaco rosato, pietra a vista, mattoni, cemento) scelti per edificio con un hash dell'id OSM. Ogni famiglia ha un intervallo di tinta e di sporco diversi. La scelta tiene conto dell'età stimata: centro storico più pietra e intonaco irregolare, periferia più cemento e intonaco liscio.
2. **Ritmo delle finestre.** Larghezza e altezza delle aperture e numero di piani variano per edificio; porta al piano terra sul lato che guarda la strada, vetrina dove il luogo del catalogo è un negozio.
3. **Persiane e tapparelle** come istanze (aperte, chiuse a metà, chiuse) con colori verde, marrone, bianco.
4. **Interni finti.** Nelle finestre, a distanza media, uno shader di *interior mapping* (una stanza finta per finestra, con colore e profondità diversi): di notte le finestre accese danno profondità senza costare geometria. Percentuale di finestre accese legata all'ora di gioco.
5. **Sporco e invecchiamento.** Occlusione ambientale al piede dei muri (colore vertice), macchie di umidità sotto cornicioni e pluviali, usura dell'intonaco con una maschera a rumore.
6. **Tetti.** Coppi a bande con colmo e tegole del colmo, antenne TV, camini diversi, qualche lucernario; pannelli solari sui tetti più recenti.
7. **Edifici-simbolo.** Chiesa, campanile, municipio, piazza e castello dove ci sono, individuati per id OSM o per tag (`amenity=place_of_worship`) e sostituiti da modelli GLB fatti a mano o da foto (fotogrammetria). Pochi edifici, molta cura. Ogni modello con attribuzione e senza marchi.
8. **Piazze e vicoli.** Pavimentazione in pietra con giunti (normal map), panchine, fontane, cestini, fioriere, lampioni a mensola sui muri del centro storico.
9. **Muri e recinti** tra le proprietà, cancelli, garage, tettoie con lamiera: gli elementi minori che riempiono lo spazio tra gli edifici.

**Criteri di accettazione**

- In una via del centro, due edifici adiacenti non hanno la stessa facciata.
- Di notte, circa un terzo delle finestre è acceso e ha profondità visibile da 10–30 m.
- Il numero di draw call degli edifici resta basso: mesh unite per tile, istanze per i dettagli.

## Veicoli

Priorità massima: è la parte più semplice del gioco e quella che il giocatore vede sempre. Oggi `src/entities/vehicle.ts` costruisce ogni auto con forme primitive a partire da `VehicleSpec` in `src/sim/vehicle-catalog.ts` (22 modelli con lunghezza, larghezza, altezza, passo, carreggiata, raggio ruota). La fisica (`src/sim/car.ts`) non va toccata.

**Architettura da realizzare**

1. **Loader GLB con fallback.** Nuovo file `src/entities/car-model.ts`. Per ogni veicolo cerca `public/models/cars/<id>.glb`, poi `public/models/cars/<stile>.glb` (stile = `hatch`, `suv`, `crossover`, `trike`), con `GLTFLoader` più `MeshoptDecoder`/`DRACOLoader`. Se nessun file si carica, resta il modello procedurale attuale. `Vehicle.setSpec()` deve restare sincrono: il GLB sostituisce il corpo quando arriva, e se nel frattempo il veicolo è cambiato, il risultato viene scartato.
2. **Normalizzazione.** Il GLB viene ruotato perché il muso sia verso -Z (l'asse in avanti usato dal gioco), centrato sul piano a terra e scalato alle misure `length`/`width`/`height` della scheda, con tolleranza (se il rapporto si discosta di oltre 12% si scala in modo uniforme sull'asse più lungo e si accetta la differenza sugli altri).
3. **Ruote.** Cercare i nodi con nome che contiene `wheel`, `tire`, `tyre` o `ruota`. Per ciascuno creare un pivot al centro del suo riquadro, riparentare il nodo con `attach()`, e collegarlo alle liste esistenti (`frontPivots` per lo sterzo, `wheels` per la rotazione). Se il GLB non ha le ruote separate, nasconderle e usare quelle procedurali, migliorate (punto 8).
4. **Vernice.** Materiali il cui nome corrisponde a `/paint|body|carpaint|carrozz/i` ricevono `color` da `setPaint()` e, se sono `MeshStandardMaterial`, vengono convertiti in `MeshPhysicalMaterial` con `clearcoat` 1, `clearcoatRoughness` 0.05–0.1, `metalness` 0.3–0.6. Nessun materiale corrispondente: `setPaint()` non fa nulla senza errori.
5. **Vetri.** Materiali con nome `glass|window|vetro`: `transparent`, opacità 0.35–0.5, `roughness` 0.05, `metalness` 0.1, `envMapIntensity` alta, `depthWrite: false`. Evitare `transmission` fisica: costa un passaggio di scena in più.
6. **Luci.** Fari e fanalini: materiali `emissive` controllati da `setLights()` (esiste già). Aggiungere fanalini rossi più intensi in frenata e luci di retromarcia, usando `state.brake` e `state.gear` della fisica.
7. **Ombre e riflessi.** `castShadow` sul corpo, `receiveShadow` sugli interni; i riflessi arrivano già da `scene.environment` (generato da `sky.ts`).
8. **Ruote procedurali migliori (anche come fallback).** Pneumatico con profilo arrotondato (`LatheGeometry`), battistrada come normal map, cerchio a 5 razze, disco freno visibile dietro, passaruota scuro. Sostituire il cilindro a 16 lati.
9. **Dettagli dinamici.** Sospensioni (compressione in curva e in frenata, già abbozzate da pitch/roll), volante che gira, specchietti, targa generica con testo fittizio, polvere sugli sterrati, fumo leggero allo scarico a freddo.
10. **LOD.** Auto lontane (oltre 80 m) con una versione semplificata del GLB (sotto 5 mila triangoli) o col corpo procedurale; interni solo sotto i 15 m.
11. **Traffico (fase successiva).** Le stesse auto in `InstancedMesh` quando sono lontane, per riempire le strade senza costo.

**Mappatura dei veicoli in poche famiglie di modello.** Le sei auto di serie su
GLB (`public/cars/`) coprono già supercar, SUV e utilitaria con modelli veri;
per le altre 21 voci procedurali non serve un GLB per ognuna: bastano 5–7
carrozzerie, ricolorate e scalate alla scheda.

| Famiglia GLB | Veicoli del catalogo (`id`, lunghezza in m) | Note |
| --- | --- | --- |
| `hatch-small` | `panda-classic` 3,41; `panda-new` 3,65; `kia-picanto` 3,59; `fiat-500` 3,55 | utilitarie corte; tetto `boxy` |
| `hatch-medium` | `punto` 3,80; `c3` 3,99; `toyota-yaris` 3,95; `ford-fiesta` 3,95; `dacia-sandero` 4,09; `fiat-600` 4,17 | alcune con tetto `sloped`, altre `boxy` |
| `crossover` | `500x` 4,25; `captur` 4,13; `junior` 4,17; `nissan-qashqai` 4,43; `peugeot-3008` 4,56 | stile `crossover` nel catalogo |
| `suv` | `renegade` 4,26; `cupra-formentor` 4,45; `alfa-romeo-tonale` 4,51; `audi-q3` 4,49; `bmw-x1` 4,50; `mercedes-gla` 4,44 | stile `suv`, tetto `boxy` |
| `trike` | `trike` 2,85 | modello a parte, tre ruote (`wheelLayout: 'three'`) |

I nomi nel catalogo sono quelli del gioco; i modelli 3D non devono riprodurre il marchio.

**Dove trovare i modelli.** Kenney "Car Kit" e Quaternius (CC0, stile semplice e pulito, il caso più sicuro). Sketchfab per auto più realistiche: filtrare per "Downloadable" e licenza, leggere ogni licenza (spesso CC-BY, con obbligo di attribuzione), non usare modelli di marche reali. Alcuni esempi di `three.js/examples/models/gltf` hanno licenza propria: controllare prima di copiarli nel progetto.

**Criteri di accettazione**

- `npm run build` e `npm test` verdi; senza nessun GLB in `public/models/cars/`, il gioco si comporta esattamente come oggi.
- Con un GLB di prova, cambiando veicolo con `B` il modello cambia, le quattro ruote girano e due sterzano, il colore cambia con `K`.
- Un'auto a 3 m dalla camera mostra riflessi del cielo sulla vernice e sui vetri.
- Cambiare veicolo 30 volte di seguito non aumenta la memoria (le geometrie e i materiali vengono liberati: `dispose()`).

## Personaggio e persone

Il giocatore usa un avatar con scheletro (`src/entities/human-model.ts`, `player.ts`, `appearance.ts`) con clip di camminata, corsa e riposo caricate da `public/models/*.glb`, provenienti dalla Ready Player Me Animation Library. La licenza (scritta in `public/models/ATTRIBUTION.md`) consente l'uso solo con avatar Ready Player Me e vieta di ridistribuire le animazioni come libreria: va bene per una demo locale, ma prima di pubblicare il gioco bisogna rileggere i termini aggiornati, oppure passare a modelli CC0.

**Da fare**

1. **Materiali.** Pelle con `MeshPhysicalMaterial` (roughness 0.5–0.7, un velo di `sheen` per la peluria), occhi con cornea lucida separata dall'iride, capelli a card con `alphaMap` e riflesso anisotropo leggero, tessuti con normal map della trama (cotone, jeans, lana) con tinta scelta dall'outfit.
2. **Fusione delle animazioni.** Oggi le clip sono selezionate; miscelarle in base alla velocità con un `AnimationMixer` (peso di camminata e corsa che variano in modo continuo), più una rotazione graduale del corpo in curva e un'inclinazione in accelerazione.
3. **Piedi sul terreno.** IK a due ossa per le gambe, con la quota letta da `heights.heightAt()`: i piedi non affondano sui pendii e sui gradini del marciapiede.
4. **Salita e discesa dall'auto.** Animazione di apertura portiera e ingresso, pose da seduto con mani sul volante che segue lo sterzo, braccio fuori dal finestrino opzionale. Il personaggio è visibile dentro l'auto attraverso i vetri.
5. **Abiti.** Ogni outfit è un insieme di materiali (e, dove serve, mesh aggiuntive: giacca, cappello, borsa). Mantenere il sistema `appearance.ts` e aggiungere solo texture e mesh, senza cambiare la struttura delle scelte salvate (il salvataggio `molise.life.v1` deve restare valido).
6. **Ombre e occlusione.** Il personaggio proietta ombra morbida; occlusione ambientale al contatto coi piedi.
7. **Pedoni (`src/world/pedestrians.ts`).** Più varietà con lo stesso rig: 6–8 corpi, tinte pelle e abiti diversi. Per molte persone lontane, animazione "baked" nelle texture dei vertici su `InstancedMesh` (in WebGL; l'esempio `webgpu_skinning_instancing` è solo WebGPU). Percorsi sui marciapiedi dell'OSM.
8. **Alternativa CC0.** Modelli umani con rig compatibile da MakeHuman (le esportazioni sono rilasciate CC0, da verificare sulla versione usata) o da Quaternius/KayKit per uno stile più semplice. Le clip di Mixamo hanno termini di Adobe propri: da leggere prima di includerle nel repo.

**Criteri di accettazione**

- Passando da fermo a corsa non c'è scatto visibile: la transizione dura circa 0,2–0,3 secondi.
- Su una salita del 20% i piedi restano a contatto col terreno senza compenetrarlo.
- Il personaggio personalizzato (sesso, altezza, abiti) funziona come prima e il salvataggio esistente si carica.

## Luce, cielo, meteo e post-processing

La pipeline in `src/gfx/post.ts` ha già SSAO, bloom con soglia alta, SMAA e `OutputPass`; `src/world/sky.ts` usa `Sky` con sole astronomico. Gran parte dell'effetto "da videogioco" viene da qui, non dai modelli.

**Da fare, in ordine di resa**

1. **Illuminazione ambientale dal cielo.** Verificare che `scene.environment` sia generato da `Sky` con `PMREMGenerator` e aggiornato quando il sole si muove (al massimo una volta al secondo); intensità bassa di notte. Senza questo, vernici, vetri e acqua restano opachi.
2. **Ombre a cascata** (`CSM`), come nella sezione sul paesaggio lontano.
3. **GTAO al posto di SSAO** (`webgl_postprocessing_gtao`): ombre di contatto più pulite sotto auto, alberi e muri, meno aloni. Solo nei preset `high` e `ultra`.
4. **Color grading.** Una passata `LUTPass` (`three/addons/postprocessing/LUTPass.js`) con una LUT 3D 32³, diversa per ora del giorno (alba calda, mezzogiorno neutro, tramonto arancio, notte blu). È la modifica che fa più "cinema" per meno costo.
5. **Tone mapping.** Provare `AgXToneMapping` e `NeutralToneMapping` accanto ad `ACESFilmic` (`webgl_tonemapping`), scegliendo a occhio sulle stesse tre posizioni di prova; lasciare l'esposizione legata al giorno come ora.
6. **Nebbia d'altezza e raggi di sole** (`webgl_postprocessing_godrays`) solo all'alba e al tramonto, solo in `ultra`.
7. **Notte.** Lampioni con luce emissiva e bloom, fari delle auto con riflesso sull'asfalto, finestre accese (vedi Edifici), cielo stellato e luna visibili.
8. **Pioggia credibile.** Gocce sui vetri dell'auto (shader sul materiale del vetro), spruzzi, asfalto bagnato (vedi Strade), suono già presente.
9. **Profondità di campo e aberrazione cromatica** molto leggere, solo in `ultra` e disattivabili: per effetto "cinematico" non per nascondere difetti.

**Scala dei preset (obiettivo)**

| Funzione | `low` | `medium` | `high` | `ultra` |
| --- | --- | --- | --- | --- |
| Ombre | una mappa 1024 | una mappa 1024 | CSM 2 cascate, 2048 | CSM 3 cascate, 4096 |
| Occlusione ambientale | no | no | SSAO | GTAO |
| Color grading (LUT) | sì | sì | sì | sì |
| Alberi in 3D vicini | no (card) | 20 m | 35 m | 50 m |
| Interni finti nelle finestre | no | no | sì | sì |
| Orizzonte lontano | sì (basso dettaglio) | sì | sì | sì |
| Raggi di sole, DOF | no | no | no | sì |

**Criteri di accettazione**

- Da fermo al tramonto, l'immagine ha un colore dominante riconoscibile, non un grigio uniforme.
- Cambiando preset dal tasto `G` non servono ricariche e l'immagine resta coerente.
- Il preset `low` non usa post-processing pesante.

## Fonti di asset e licenze

La colonna "Verifica" dice cosa è stato controllato: "nel repo" = scritto nei file `ATTRIBUTION.md` e nel `README.md` del progetto; "da verificare" = indicato dalla conoscenza generale, non riletto sul sito in questa sessione. L'AI di sviluppo deve aprire la pagina della licenza di ogni file prima di copiarlo nel progetto e annotarla in `ATTRIBUTION.md`.

| Fonte | Cosa offre | Licenza | Verifica |
| --- | --- | --- | --- |
| [Poly Haven](https://polyhaven.com) | Texture PBR, HDRI, alcuni modelli | CC0 | nel repo (`public/textures/ATTRIBUTION.md`) |
| [ambientCG](https://ambientcg.com) | Texture PBR (foglie, asfalto, muri) | CC0 | nel repo (`Leaf003`) |
| three.js `examples/textures` | `waternormals.jpg` | MIT | nel repo |
| [Kenney](https://kenney.nl/assets) | Car Kit, Nature Kit e altri | CC0 | da verificare |
| [Quaternius](https://quaternius.com) | Alberi, natura, veicoli, personaggi lowpoly | CC0 | da verificare |
| [Sketchfab](https://sketchfab.com) | Auto e edifici realistici | diversa per ogni modello (spesso CC-BY, con attribuzione) | da leggere per ogni file |
| Ready Player Me Animation Library | Avatar e clip di movimento | licenza propria: solo con avatar Ready Player Me, non ridistribuibile come libreria | nel repo (`public/models/ATTRIBUTION.md`) |
| MakeHuman | Corpi umani personalizzabili | esportazioni CC0 | da verificare sulla versione usata |
| Mixamo | Animazioni | termini Adobe | da verificare |
| `ez-tree` (generatore di alberi per three.js) | Alberi procedurali | da verificare | da verificare |
| OpenStreetMap | Strade, edifici, aree | ODbL 1.0 | nel repo (`README.md`) |
| AWS Terrain Tiles (Terrarium) | Quote del terreno | dati aperti | nel repo (`README.md`) |
| Esri World Imagery | Foto satellitari | uso demo non commerciale con attribuzione; per pubblicare serve un fornitore con licenza esplicita | nel repo (`README.md`) |

**Regole**

1. Mai asset con marchi, loghi o nomi di aziende reali dentro i modelli.
2. Mai asset estratti da giochi (GTA V o altri).
3. Un asset senza licenza chiara non entra nel repo.
4. Se il progetto verrà pubblicato, ricontrollare tutte le righe prima: la licenza di Esri e quella di Ready Player Me sono i due punti più delicati.

## Ordine di lavoro e regole per l'AI

Ordine consigliato, dal più visibile al più costoso. Ogni fase si chiude solo quando il suo criterio è soddisfatto e `npm test`, `npm run build` e `npm run smoke` sono verdi.

1. **Fase 0 — Misure di partenza.** Script o modalità `?bench=1` che mette la camera in tre posizioni fisse (piazza di Palata, strada di campagna, collina), a ora fissa e meteo sereno, e stampa fps, draw call e triangoli per ciascun preset, salvando uno screenshot. *Criterio:* risultati ripetibili entro il 5%.
2. **Fase 1 — Veicoli.** Loader GLB con fallback, ruote, vernice, vetri, luci, ruote procedurali migliori (sezione Veicoli). *Criterio:* quelli della sezione Veicoli.
3. **Fase 2 — Luce e look.** Ambiente dal cielo verificato, CSM, GTAO, color grading con LUT, prova dei tone mapping (sezione Luce). *Criterio:* confronto prima/dopo sugli stessi tre screenshot.
4. **Fase 3 — Strade.** Usura, rattoppi, segnaletica, bordo strada, bagnato (sezione Strade).
5. **Fase 4 — Alberi e vegetazione.** Modelli, LOD, specie, sottobosco, colture (sezione Alberi).
6. **Fase 5 — Orizzonte.** Anello d'orizzonte, nebbia esponenziale e d'altezza, colore del suolo da OSM (sezione Paesaggio).
7. **Fase 6 — Edifici.** Famiglie di facciata, interni finti, sporco, edifici-simbolo (sezione Edifici).
8. **Fase 7 — Personaggio e pedoni.** Materiali, fusione, IK dei piedi, salita in auto, pedoni variati (sezione Personaggio).
9. **Fase 8 — Ottimizzazione finale.** Conversione delle texture a KTX2, modelli compressi, controllo delle perdite di memoria, ricalibrazione dei preset sulle tre posizioni di prova.

**Regole per l'assistente AI che sviluppa**

- Leggere prima `HANDOFF.md`, `docs/ROADMAP.md` e questo documento. Non espandere la mappa oltre i cinque comuni senza richiesta esplicita.
- Lavorare una fase alla volta, con commit piccoli e messaggi chiari. Non mescolare due fasi in un commit.
- Ogni funzione nuova ha un interruttore per preset e un fallback; senza asset esterni il gioco gira come prima.
- Usare `three/addons/...` (come già nel repo), non copiare codice da esempi di three.js senza controllarne la licenza.
- Mai scaricare file da fonti senza una licenza chiara; mai inserire modelli con marchi reali; aggiornare `ATTRIBUTION.md` a ogni asset nuovo.
- Liberare sempre le risorse (`dispose()` su geometrie, materiali, texture) quando un oggetto viene sostituito.
- Non toccare la fisica (`src/sim/car.ts`), l'economia e i salvataggi (`molise.life.v1`) salvo bug dimostrato.
- Dichiarare a fine fase cosa è stato verificato in un browser reale e cosa solo con `tsc`: uno screenshot headless non sostituisce una prova a mano su GPU vera.
- In caso di dubbio su una scelta artistica, proporre due varianti con screenshot e lasciare decidere al proprietario del progetto.

## Registro di avanzamento

Legenda stato: **fatto** = nel codice e verificato con `npm test` + `npm run build`; **da verificare** = nel codice ma non ancora visto in un browser reale su GPU vera; **in corso**; **da fare**.

### 22 ottobre 2026 — base grafica

| Voce | Stato | Note |
| --- | --- | --- |
| Texture PBR CC0 (asfalto, ghiaia, intonaco, coppi, erba/roccia, corteccia, cemento, foglie, acqua) | fatto | `public/textures/`, scaricate da Poly Haven con `scripts/fetch-textures.mjs`, provenienza in `public/textures/ATTRIBUTION.md` |
| Spazio colore corretto (colore sRGB, normal/rough lineari) | fatto | `src/gfx/textures.ts` |
| IBL dal cielo (`PMREMGenerator` su cupola `Sky`, aggiornata solo se il sole si muove) | fatto | `src/world/sky.ts`, `updateEnvironment` |
| Bilanciamento luci dopo l'IBL (emisferica e ambiente ridotti, esposizione, bloom con soglia alta) | fatto | evitava il "velo bianco" dei preset alti |
| Terreno: dettaglio erba/roccia in coordinate mondo, sfumato con la distanza | fatto | `applyTerrainDetail` in `src/world/terrain.ts` |
| Strade: asfalto/ghiaia PBR, cordoli, mezzeria, strisce pedonali, stop, angoli smussati | fatto | `src/world/roads.ts` (`roundCorners`, `pushCurbWall`, `pushZebra`, `pushStopLine`) |
| Acqua: normal map che scorre | fatto | `buildWater` in `src/world/roads.ts` |
| Alberi: corteccia PBR, chiome a card con alpha e vento | fatto | `src/world/vegetation.ts` |
| Prati: ciuffi con texture alpha e vento | fatto | `src/world/grass.ts` |
| Edifici: finestre con cornice/davanzale/vetro, cornicione, comignolo, pluviali, balconi | fatto | `src/world/buildings.ts` |
| Personaggio: avatar Ready Player Me rigged + clip idle/walk/run | fatto | `public/models/`, `src/entities/human-model.ts`; licenza in `public/models/ATTRIBUTION.md` |
| Pedoni per il paese | fatto | `src/world/pedestrians.ts` |
| Arredo urbano e segnaletica verticale | fatto | `src/world/street-furniture.ts` |
| SSAO nei preset alti | fatto | `src/gfx/post.ts` |

### 22 ottobre 2026 — veicoli, luci

| Voce | Stato | Note |
| --- | --- | --- |
| Fanalini posteriori: si intensificano in frenata, diventano bianchi in retromarcia | fatto | `src/entities/vehicle.ts`, `update()`; usa `input.brake` e `state.gear`, non aggiunge geometria |
| Piano di realismo versionato nel repo | fatto | questo documento; `HANDOFF.md` §16 e `README.md` lo linkano |

Da verificare in un browser vero: che la frenata accenda i fanalini anche di giorno
e che in retromarcia il colore viri al bianco senza sfarfallare.

### 23 ottobre 2026 — sessione "tutto reale" (strade, facciate, paesaggio, veicoli, alberi)

Tutto quello che segue è nel codice e verificato con `npm test` (155/155) e
`npm run build`. Non è ancora stato guardato in un browser su GPU vera: per il
registro vale quindi **fatto nel codice**, **da verificare a schermo**.

| Voce | Stato | Note |
| --- | --- | --- |
| Usura dell'asfalto nello shader: tracce delle ruote a u = 0,30 e 0,70 (più scure e più lisce), centro corsia più chiaro, macchie a bassa frequenza in coordinate mondo | fatto | `applyRoadWear` in `src/world/roads.ts`, agganciata a `<map_fragment>` e `<roughnessmap_fragment>` |
| Asfalto bagnato guidato dal meteo: scurisce e lucida (roughness → 0,12) con la pioggia | fatto | uniform `uRoadWet`; `applyWetness` in `src/game.ts` lo pilota insieme alle altre superfici |
| Chiusini in ghisa al centro corsia e caditoie a filo cordolo, lungo tutte le strade asfaltate | fatto | `buildRoadDrainage` in `src/world/street-furniture.ts`; due `InstancedMesh`, texture a cerchi concentrici |
| Famiglie di facciata: intonaco chiaro, intonaco tinteggiato, pietra a vista, mattoni; una mesh per famiglia | fatto | `src/world/buildings.ts` (`facadeFamily`, `wallMats`), tinte dedicate in `STONE_COLORS`/`BRICK_COLORS` |

### 23 ottobre 2026 — notte, sessione autonoma (satellite, erba)

| Voce | Stato | Note |
| --- | --- | --- |
| Zoom satellite: z18 entro 500 m, z17 fino a 3200 m, z16 oltre | fatto | `zoomForDistance` in `src/world/imagery.ts`, test in `tests/imagery.test.ts`; commit `95fafd2` |
| Titolo di debug con chunk caricati / texturizzati / a z17+ (`?imagery=debug`) | fatto | commit `e8c66e6` |
| Erba: ciuffi più corti sul ciglio, pieni da 6 m in poi nei campi | fatto | `distanceFromRoad` in `src/geo/osm.ts`, uso in `src/world/grass.ts`; test in `tests/osm.test.ts`; commit `7bad2c0` |
| Smoke test `npm run smoke` | **non superato** | 4 errori `ERR_NETWORK_CHANGED` nel primo run; run successivi bloccati/timeout con SwiftShader (~2 fps) |

Verificato nel codice ma non a schermo: selettore meteo già presente e coperto da
`tests/sun-clock.test.ts`. Nessuna modifica ai pali della luce né alla luce del
giorno senza vederli.

Da verificare a schermo: il bordo dell'erba lungo le strade e la nitidezza z17/z18
a Palata. Non ancora fatti: marciapiedi con cordolo (il codice ha già cordolo e
interruzioni agli incroci), strisce e stop solo agli incroci reali, pali della luce
con pozze di luce, selettore meteo, luce del giorno. Il `sunIntensity` attuale
(`applyAtmosphere`, fattore 3,0) è da rivedere solo a schermo.
| Texture PBR CC0 nuove: `stonewall` (rustic_stone_wall), `brick` (worn_brick_wall), `plaster2` (painted_plaster_wall) | fatto | `scripts/fetch-textures.mjs` + `public/textures/ATTRIBUTION.md` |
| Ombre delle nuvole sul terreno: rumore largo che scorre col vento, pilotato dalla copertura nuvolosa diurna | fatto | `setCloudShadow` in `src/world/terrain.ts`, chiamata da `applyAtmosphere` |
| Alberi per specie: ulivi negli uliveti (`orchard`), cipressi nei filari e sparsi nei boschi, latifoglie altrove | fatto | `src/world/vegetation.ts`; tre insiemi di istanze, vento condiviso anche per i cipressi |
| Veicoli: battistrada come `bumpMap`, disco freno dietro le razze, terminale di scarico cromato | fatto | `src/entities/vehicle.ts` (`treadTexture`, `wheelAt`) |
| Fanalini posteriori: più intensi in frenata, bianchi in retromarcia | fatto | `src/entities/vehicle.ts`, `update()` |
| Finestre accese di notte in circa un terzo delle case, con emissività che segue l'ora | fatto | `src/world/buildings.ts` (`setWindowGlow`), chiamata da `applyAtmosphere` |
| Muretti a secco lungo le strade di campagna, con tratti crollati | fatto | `src/world/dry-stone.ts`, un solo `InstancedMesh` con la texture `stonewall` |
| Sottobosco: cespugli a card di foglie ai piedi degli alberi | fatto | `src/world/vegetation.ts` (`bushList`, `bushGeo`) |
| Cielo notturno: 1700 stelle con magnitudine e temperatura, disco lunare con alone | fatto | `src/world/sky.ts` (`setNightSky`, `moonTexture`) |
| Rattoppi di catrame rettangolari (celle 7 × 9 m) e crepe sottili, in coordinate mondo nello shader dell'asfalto | fatto | `applyRoadWear` in `src/world/roads.ts` (`roadHash`, `roadNoise`, `roadToppa`, `roadCrack`) |
| Targhe italiane vere: canvas con banda blu, sigla `CB` e numero deterministico per veicolo | fatto | `src/entities/vehicle.ts` (`plateTexture`, `plateNumber`) |
| Pali della luce e fili in catenaria lungo le strade asfaltate | fatto | `src/world/power-lines.ts`; un `InstancedMesh` per i pali, un `LineSegments` per i fili |
| Erba che sconfina sul bordo dell'asfalto, più secca e polverosa | fatto | `src/world/grass.ts` (`edge`, fascia di 40 cm fuori dal manto) |
| Chiesa di paese con campanile: navata, tetto a falde, facciata con rosone e portale, cella campanaria, cuspide, croce e orologio | fatto nel codice | `src/world/church.ts`; cerca da sola un posto libero attorno a `START`, l'impronta entra in `BuildingIndex` (`add`) |

Da verificare a schermo, in ordine di rischio: che l'usura dell'asfalto non
sballi la luminosità di giorno; che i chiusini non affiorino sopra il manto nei
punti dove il nastro è più alto; che i muretti a secco non invadano la carreggiata
nelle curve strette; che i cespugli non restino sospesi sui pendii ripidi; che
stelle e luna non si vedano ancora di giorno; che la chiesa non sbatta contro
una casa e che lo zoccolo copra il dislivello del terreno.

### 23 ottobre 2026 — priorità dell'utente

Verificato con `npm test` (161/161), `npm run build` e `npm run smoke` sulla
build finale (`index-A5tfBz6X.js`): 9/9 chunk texturizzati, 1 chunk in dettaglio
z17, nessun errore e nessun warning in console, guida e camminata funzionanti.
Il controllo a schermo resta da fare su GPU vera: qui il rendering gira su
SwiftShader a ~2 fps.

| Voce | Stato | Note |
| --- | --- | --- |
| Paesaggio lontano definito | fatto nel codice | `public/geo/world-imagery.jpg`: mosaico **Sentinel-2 cloudless 2025** (CC BY 4.0, EOX) dell'intero bbox, ritagliato per chunk in `ImageryStreamer.baseChunkTexture`. Ogni chunk ha subito un'immagine vera; le tile Esri z18 (≤ 500 m), z17 (fino a 3200 m) e z16 (oltre) affinano il dettaglio. Prima i chunk lontani restavano verdi perché lo streaming non faceva in tempo. |
| Edifici troppo bassi | fatto nel codice | `minBuildingHeight` in `src/geo/osm.ts`: ≥ 3,4 m sotto 24 m² (garage), ≥ 6,4 m sotto 70 m², ≥ 7,6 m sotto 160 m², ≥ 8,6 m sopra. |
| Edifici in salita bucati sotto | fatto nel codice | la base è il punto **più basso** dell'impronta (`buildOne`); lo zoccolo in pietra copre il dislivello sul lato in salita, niente vuoto a valle. |
| Porte interrate | fatto nel codice | il portone parte dalla quota del terreno davanti a lui, non dalla base; le finestre del piano terra sono campionate sul punto della facciata. |
| Strade, marciapiedi e asfalto allineati | fatto nel codice | `RoadIndex.surfaceOffset` restituisce la stessa quota del disegno: asfalto +0,20 m, marciapiede +0,38 m. Giocatore e auto ci camminano sopra (prima il giocatore affondava di 20 cm: effetto "sabbie mobili"). |
| Guida credibile | fatto nel codice | sterzo più lento e lock ridotto con la velocità, con tetto di accelerazione laterale (`src/sim/car.ts`). Panda vecchia simulata 0–100 in 15,2 s (scheda: 16,2 s); a 50 km/h una sterzata piena gira ~21°/s, non ~190°/s. Test in `tests/driving.test.ts`. |
| Panchine a caso | fatto nel codice | solo lungo strade asfaltate, davanti a una casa, 1,1 m oltre il bordo dell'asfalto, schienale verso la casa; scartate se cadono dentro un edificio o su un pendio ripido. |
| Console pulita | fatto nel codice | `THREE.Timer` al posto di `THREE.Clock`; niente più cloni di texture con `needsUpdate` prima che l'immagine sia caricata (facciate, tetto della chiesa, normali dell'acqua). |

**Non ancora fatto:** la segnaletica (verticale e orizzontale) è quella di prima;
gli incroci usano ancora il micro-offset per strada. La pendenza delle strade
segue il DEM, ma il DEM è a 10 m: sotto questa soglia non si può inventare.

> **Nota del 23/10/2026.** `npm run smoke` ha trovato un errore reale: nello
> shader dell'usura una variabile si chiamava `patch`, parola riservata del
> linguaggio GLSL, e il programma non compilava affatto. Corretto in `a5c1a2d`
> (rinominata `blotch`, cache key `road-wear-v2`). Da qui in avanti lo smoke
> test va considerato parte della verifica minima: il build da solo non vede
> gli errori di shader.

### 23 ottobre 2026 — sessione notturna (satellite e debug)

- Satellite: `zoomForDistance` torna a z18 entro 500 m, z17 fino a 3200 m, z16 oltre (commit `95fafd2`, test `tests/imagery.test.ts`).
- Debug: `?imagery=debug` mostra nel titolo chunk, texture e chunk z17+ (commit `e8c66e6`).
- `npm test` 163/163 e `npm run build` verdi.
- **Smoke NON superato.** Su questa macchina lo smoke ha riportato 4 errori `ERR_NETWORK_CHANGED` in console (il gioco carica 46/46 chunk texturizzati) e in un run successivo è andato in timeout a 2 fps (SwiftShader). Non è un esito verde: va rilanciato su una macchina con GPU e rete stabile.
- Non fatta la segnaletica e gli incroci (priorità 5 residua): richiede verifica visiva.

### 23 ottobre 2026 — audit prestazioni (erba e mappa)

- **Erba: ricostruzione da ~6,7 s a ~40 ms, spezzata su più frame.** Il campo
  veniva riempito per rifiuto casuale nel disco da 40 m: in centro a Palata
  l'accettazione era ~17%, cioè ~480.000 query spaziali per 82.000 ciuffi.
  Misurato con un benchmark Node sui dati reali (`heights.bin`, `osm.json`):
  6,7 s per la sola parte CPU. Ora `src/world/ground-mask.ts` rasterizza una
  volta sola strade, edifici e pendenza su una griglia da 0,5 m; i ciuffi sono
  distribuiti per cella (stratificati) e le matrici vengono scritte con un
  budget di 4 ms per frame. L'erba di bordo usa `RoadIndex.forEachRoadEdge`
  (campionamento dei cigli) invece di ~190.000 tentativi: da ~1,4 s a ~5 ms.
- **Query spaziali**: `RoadIndex` ha un AABB per segmento e `BuildingIndex.hitsCircle`
  senza allocazioni; `resolveCircle` resta per la fisica. Ne beneficiano anche
  alberi, cespugli, muretti e arredi.
- **Mappa grande**: satellite + 1.090 strade erano ridisegnati a 10 Hz con la
  mappa aperta. La base ora è in un canvas fuori schermo, invalidato solo quando
  arrivano nuove tile; sopra si ridisegnano i marker.
- **Pedoni**: quota da `RoadIndex.surfaceOffset` (marciapiede, asfalto o
  terreno) invece di `ROAD_LIFT + CURB_HEIGHT` fisso; agli incroci non restano
  più sospesi.
- **Verifica**: `npx tsc --noEmit` e `npm test` verdi (171 test, 6 nuovi su
  maschera e cigli); `npm run build` verde. `npm run smoke` ha raggiunto
  `ready:true, running:true`, 46/46 chunk texturizzati, `tileErrors: 0`,
  `errorCount: 0`; il processo si è bloccato dopo lo screenshot (problema noto
  della macchina SwiftShader, non del gioco), quindi **non** è un esito smoke
  completo.
- **Da verificare a schermo**: densità dell'erba dopo la stratificazione,
  continuità del ciglio e fluidità in auto (il budget da 4 ms non dovrebbe
  vedersi, ma va confermato su GPU vera).

### 23 ottobre 2026 — auto GLB, campagna, pioggia/neve/foschia

| Voce | Stato | Note |
| --- | --- | --- |
| Sei auto di serie su GLB guidabili (Punto, Aventador, 458, Defender, R8, Terramar) | fatto | `public/cars/manifest.json` + `src/world/car-library.ts`; normalizzazione, vetri scuri, ruote riconosciute/separate, preload con generation counter |
| Cambio a 7 e 8 marce | fatto | `SEVEN_SPEED`, `EIGHT_SPEED` in `src/sim/car.ts`; supercar a 7, Defender a 8 |
| Campagna popolata: 18 case, 11 rimesse, 46 alberi (high) | fatto | `src/world/farmsteads.ts`; solo fuori dal paese, deterministico, con impronte in `BuildingIndex` prima di erba e vegetazione |
| Pioggia con schizzi sul terreno vero | fatto | `src/world/precipitation.ts`; pool di 260 anelli, sampler che tiene conto dell'asfalto |
| Neve soffice | fatto | sprite con gradiente radiale e shader dedicato |
| Foschia bassa a banchi | fatto | `src/world/mist.ts`; 16 sprite ancorati al mondo, più densi all'alba/tramonto, con nebbia e pioggia |
| Blend continuo idle/walk/run | fatto | `src/entities/human-model.ts`; smoothstep + rinormalizzazione dei pesi |
| Verifica | fatto | `npm run build` ✅, `npm test` 193/193 ✅, gioco a preset high senza errori console |

### Prossimi passi (in ordine)

1. **Verifica a schermo delle priorità del 23/10** (paesaggio, edifici, strade,
   guida, console) su GPU vera, con `npm run smoke` per gli shader.
2. **Segnaletica e incroci**: STOP/dare precedenza/limite sono ancora quelli di
   prima; valutare le strisce di arresto e la continuità dei marciapiedi.
3. **Look** (Fase 2): provare un tone mapping filmico, una LUT leggera, e
   valutare le shadow cascade solo se la qualità delle ombre lunghe non basta.
4. **Veicoli** (Fase 1): i sei GLB di serie ci sono (licenza da verificare per la
   distribuzione); per le 21 voci procedurali restano ruote con `LatheGeometry`,
   tergicristalli, cornici dei vetri e un LOD per le auto lontane.
5. **Edifici** (Fase 6): interni finti dietro le finestre. Persiane, davanzali
   e la chiesa con il campanile ci sono già.
6. **Personaggio** (Fase 7): materiali pelle/capelli e IK dei piedi sul terreno;
   la fusione idle/walk/run continua è già stata fatta.
7. **Alberi** (Fase 4): LOD vicino con rami veri, ceppaie, alberi caduti.
8. **Orizzonte** (Fase 5): anello DEM 9–10 e nebbia esponenziale. Non fatto:
   la nebbia lineare attuale (3000–4600 m) copre già il bordo del terreno, e
   senza una verifica visiva il rischio di buchi o doppio terreno è alto.

> **Nota sulla chiesa.** Nei dati veri di Palata il centro è troppo denso per
> un edificio di 15 × 21 m: con l'ingombro completo libero da strade e case la
> prima posizione utile cade a circa 120 m da `START` (verificato con un test
> temporaneo sui dati `public/geo`). Non è un errore di posizionamento: è la
> prima area libera. Se in futuro si vuole la chiesa sulla piazza, va tolta
> qualche impronta OSM e ricostruito l'indice prima di piantare la vegetazione.

### 24 ottobre 2026 — qualità su ogni macchina (fase 8 anticipata)

Il vincolo 3 del piano («il preset `low` deve restare giocabile su un PC
modesto») non era rispettato: `low` costruiva ancora 14.000 alberi, ombre su
tutto e tutte le decorazioni delle facciate. Ora la scala è **compatibilità →
bassa → media → alta → ultra** e ogni gradino decide anche *quanto mondo*
esiste, non solo la risoluzione.

| Voce | Stato | Note |
| --- | --- | --- |
| Preset `minimal` (Compatibilità) | fatto, verificato headless | niente ombre, erba, pedoni, meteo, post, kit, chiusini; facciate semplificate; 2.200 alberi; terreno 1,5 km a z15 |
| Budget di mondo per preset (alberi, cespugli, pedoni, luci, raggio terreno) | fatto | `src/gfx/quality.ts`, letto da `game.ts`, `vegetation.ts`, `city-props.ts`, `farmsteads.ts`, `street-furniture.ts` |
| Auto-detect dalla GPU reale | fatto, testato | `classifyQuality` pura + `readGpuRenderer`; software → minimal, iGPU → low/medium |
| Degradazione automatica a gradini | fatto, avvio gradini osservato | ombre → erba → meteo → terreno → scala 0,5×; permanente per la sessione |
| Facciate semplificate su minimal/low | fatto, misurato | `building-trim` 2.299.200 → 203.276 triangoli |
| Palo dei cartelli senza il pezzo del kit | fatto | 28.000 triangoli per cartello → cilindro da 48; `road-signs` 9,9 M → decine di migliaia |
| Composer di post-processing creato solo se serve | fatto | su minimal/low/medium non alloca render target |
| Tetto satellite applicato al terreno | fatto (bug corretto) | prima ogni preset scaricava z18; ora minimal z15, low z16 |
| Selettore qualità nelle impostazioni | fatto | + `G` cicla su cinque livelli, avviso sulla densità al riavvio |
| Messaggio WebGL2 assente | fatto | `main.ts`, niente più pagina nera |
| Misura fps su GPU vera | **da fare** | le misure di questa sessione sono su SwiftShader (2–3 fps) e servono solo a contare triangoli e draw call |

Misure headless a Palata, preset `minimal`: **5,29 M → 2,54 M triangoli**,
123 draw call. `high` carica con 839 draw call e 35,8 M triangoli (passata
d'ombra e post inclusi), nessun errore runtime. La degradazione automatica,
provata su `medium` a 0,5 fps, ha applicato tutti i gradini portando il frame
da 11,88 M a 7,25 M triangoli e da 386 a 216 draw call. `tsc` ✅, `npm test`
**203/203** ✅, `vite build` ✅, `SMOKE_QUALITY=minimal npm run smoke` ✅.

Prossimo taglio consigliato: marciapiedi e cordoli esistono su tutte le strade
asfaltate (750.000 + 231.000 triangoli); limitarli alle strade con edifici
entro ~40 m è più realistico e toglie la voce più grossa rimasta su `minimal`.


### 24 ottobre 2026 — vernice delle auto, orizzonte e passo dei pedoni

| Voce | Stato | Note |
| --- | --- | --- |
| Vernice dei GLB riconosciuta per materiale e portata a clearcoat | fatto, verificato headless sui sei modelli | `src/gfx/car-paint.ts`: `isPaintMaterial`, `choosePaintMaterials`, `paintMaterialFrom`; il Ferrari dà `Body_Color` tintabile, clearcoat 1,0, rugosità 0,32 |
| Tinta della scocca anche sulle auto GLB, clonata per istanza | fatto | `Vehicle.buildExternal` sostituisce il materiale solo sulle mesh della scocca; il template resta pulito |
| Tinta per i modelli con il colore nella texture (Audi blu, Defender grigio) | fatto, mappa misurata | nello shader `tinta × clamp(0,55 + 1,6 × luminanza)`; moltiplicare il colore per la mappa avrebbe dato nero |
| Atlanti unici (Aventador scocca + cerchi) solo desaturati | fatto | `tintable: false`, così non si colorano le gomme |
| Saturazione della vernice regolabile dalle impostazioni | fatto, provato | slider 35–100% (default 82%), uniform condivisa, valore in `localStorage`; etichetta e salvataggio verificati in Chrome |
| Fari e fanalini emissivi dei GLB pilotati dalla notte | fatto | 0 di giorno, 1,9 di notte, senza `needsUpdate` per frame |
| Cintura di montagne oltre il DEM | fatto, testata | `src/world/far-terrain.ts`: anello 10.900 triangoli, una draw call, quota DEM al bordo, rumore ridged fuori dal mondo |
| Nebbia serena portata a ~8 km | fatto | prima le colline a 4 km sparivano e l'orizzonte era un muro bianco |
| Passo dei pedoni sincronizzato nel blend camminata/corsa | fatto, testato | `syncStridePhase` in `src/entities/human-model.ts` |

Verifiche di questa sessione: `tsc --noEmit` ✅, `vitest run` **233/233** ✅,
`vite build` ✅, `SMOKE_QUALITY=minimal npm run smoke` ✅ (124 draw call,
2,55 M triangoli, nessun errore console). Resta da guardare a schermo su GPU
vera: colore delle auto dopo la tinta, montagne all'orizzonte, fari di notte.

### 26 ottobre 2026 — Fase 0: banco prova e misure di partenza

| Voce | Stato | Note |
| --- | --- | --- |
| Banco prova `?bench=1` | fatto | ora 16:00, meteo sereno, niente HUD/input, niente degradazione adattiva, pose fisse; non altera il rendering |
| Script `scripts/bench.mjs` | fatto, verificato su GPU vera | Chromium hardware via CDP (`--use-angle=d3d11`), 20 s per vista, screenshot + `results.json`; sceglie Chrome/Brave/Edge |
| Script `scripts/bench-analyze.mjs` | fatto | sceglie le pose dai dati OSM/DEM: strada con pendenza laterale, crinale aperto, piazza |
| Tre viste fisse | fatto | SS 157 a ~1 km da Palata; crinale a est (2.377,4 / −1.842,8); Piazza del Popolo (865,8 / −2.298,2) |
| Misure di partenza | fatto | `captures/baseline/<preset>/`: minimal 100 fps, low 50, medium 25–27, high 16 sulla Adreno X1-45 |
| Metodo fps minimi | fatto | media su finestre da 1 s, non singolo frame |
| Memoria texture | fatto, stimata | conteggio `renderer.info` + stima byte immagini di scena; render target esclusi |

La Fase 0 non cambia il mondo: è solo infrastruttura di misura. La Fase A parte
da questi numeri con un "prima" rifatto subito prima delle modifiche.

> Aggiornare questa tabella e il registro a ogni blocco di lavoro completato, con la data.
