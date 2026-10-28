# Molise Open World

**Un mondo aperto libero e giocabile tra Palata (CB) e i paesi vicini**, costruito da zero su mappe e dati geografici aperti. Si cammina, ci si guarda intorno, si prende un'auto e si guida per la valle.

> Progetto indipendente e sperimentale, ispirato ai "fondamentali" dei giochi open-world (camminare, esplorare, guidare).
> **Non contiene e non usa nessun asset, codice o dato estratto da GTA V / Rockstar Games**: tutto il mondo è generato da fonti aperte.
>
> **Stato, comandi, limiti e prossimi passi:** [HANDOFF.md](HANDOFF.md) — il documento da leggere prima di riprendere il progetto su un'altra macchina.
> **Specifica completa del simulatore:** [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md), con lo stato di avanzamento punto per punto.
> **Piano di realismo grafico (documento vivo):** [docs/REALISM-PLAN.md](docs/REALISM-PLAN.md) — cosa è fatto, cosa manca e in che ordine.
> **City kit e auto:** [docs/CITYKIT.md](docs/CITYKIT.md) — cosa si usa e perché; [docs/GARAGE.md](docs/GARAGE.md) — auto di serie su GLB e import da Smooth Voxels; [docs/VEHICLE_DATA.md](docs/VEHICLE_DATA.md) — schede tecniche; [docs/ROADMAP-VISUALS.md](docs/ROADMAP-VISUALS.md) — cosa manca e gli esempi three.js.

**Area giocabile:** Palata · Montecilfone · Acquaviva Collecroce · Tavenna · Castelmauro (~14 × 12 km di campagna molisana)

---

## Cosa c'è dentro

- **Casa base: Palata.** Il gioco parte dal centro del paese e la mappa segna Palata come "casa".
- **Terreno 3D** a chunk (912 m) con DEM a 5 m, **mosaico Sentinel-2 dell'area locale come base immediata** e tile raster aperte configurabili per il dettaglio, con normal map ricavata dal rilievo.
- **Meteo reale opzionale** (`P` → interruttore): condizioni attuali, nuvole, pioggia/neve e **sole alla posizione e ora vere**, con alba/tramonto del giorno. Aggiornamento ogni 10 minuti, fallback al pomeriggio fisso se lo spegni.
- **Ora del giorno manuale** (`P` → slider 0–24): alba, mezzogiorno, tramonto e notte, con preset meteo sereno/nuvoloso/pioggia/neve/nebbia. Il vento reale Open-Meteo resta attivo anche con il meteo manuale e muove alberi, cespugli, erba e precipitazioni; senza un dato reale il vento resta calmo, non inventato.
- **Trenta veicoli in catalogo** (`P` → Veicolo, oppure `B` per cambiarli al volo): tutte le auto e moto dell'archivio `cars.zip`, dai modelli del 1930 alla Ferrari F1 2019. Ogni voce ha ingombri, passo, raggio ruota e **prestazioni reali** della versione rappresentata: cilindrata, potenza, coppia, 0-100 e velocità massima vengono dalle schede tecniche (vedi `docs/VEHICLE_DATA.md`).
- **Trenta modelli GLB** (`public/cars/`): Audi R8 (2010 e 2023), BMW M4 Competition, M3 E46 e 326 anni '30, Yamaha MT-09 SP, Audi Novulari, Cupra Terramar, DeTomaso P900, Ferrari F1 e LaFerrari, Fiat 500/Abarth/Multipla/Uno/Panda/Punto, Lamborghini Revuelto, Land Rover Defender, MG Cyberster, Porsche 911, SEAT León Cupra, Tesla Cybertruck, Vespa, Aston Martin DB11, Honda Civic RS, Volkswagen Crafter e Golf GTI. I modelli vengono normalizzati una volta sola (unità di lunghezza, muso a +Z, base a terra), le ruote sono riconosciute per nome o separate geometricamente, e i vetri opachi dei GLB da showroom diventano vetro scuro trasparente. I file restano fuori da git e il manifest versionato dice slug, file, yaw e lunghezza; crediti e licenze sono in `ATTRIBUTION.md`.
- **Pilota sulle due ruote**: Yamaha MT-09 SP e Vespa mostrano il corpo del giocatore seduto in sella, con piega in curva e mani verso il manubrio; a piedi il veicolo parcheggiato resta vuoto.
- **Auto personalizzate da Smooth Voxels**: modella un'auto in <https://www.smoothdev.nl/smoothvoxels/>, esportala in GLB e importala dal menu o trascinandola sulla finestra. Ogni auto riceve una scheda tecnica dagli ingombri, è guidabile subito e resta salvata in IndexedDB (max 12 per browser); un pulsante gira il **muso di 180°** se l'export è uscito al contrario. Flusso e convenzioni in `docs/GARAGE.md`.
- **Vernice con riflessi**: la cubemap del cielo passa ai materiali del veicolo con un boost per famiglia (vernica, vetri, cromature), così il clearcoat ha riflessi veri e non sembra plastica.
- **Modalità vita e negozi di Palata** (`E` vicino a un'attività): catalogo di luoghi (ristorazione, alimentari, abbigliamento, servizi, punti d'interesse), pannello attività con menu simulato, conferma dell'acquisto con costo e saldo residuo, spesa, guardaroba e ATM simulato.
- **Denaro SOLO virtuale**: contanti e conto sono valute di gioco (500 € e 2.000 € iniziali, in centesimi interi). Nessun collegamento a carte, conti, IBAN, gateway o pagamenti reali. Il portafoglio (`I`) mostra contanti, conto e movimenti.
- **Bisogni e orologio di gioco**: fame, energia e divertimento calano col tempo; mangiare, bere, comprare, passeggiare e dormire li modificano. Avvisi graduali, nessuna morte improvvisa. Si dorme a casa con `E` (avanza il giorno e recupera energia).
- **Casa unica**: la modalità vita ha una sola casa (indicata in mappa come "Garage") e una sola auto attiva; dormire e salvare si fanno lì.

- **Casa / garage** (`T` oppure dal menu): scegli un edificio reale del paese come base; il segnalibro resta su minimappa e mappa grande, l'auto si parcheggia lì e con `L` ci torni quando vuoi.
- **Colore carrozzeria**: dieci tinte, ricordate veicolo per veicolo; si cambiano dal menu o dal garage.
- **Personaggio personalizzabile** (`P`): sesso, altezza 1,50–2,00 m, corporatura, carnagione, capelli (stile e colore), barba e outfit — casual, elegante, formale, tuta, campagna, sportivo, hippie — con tre varianti di tono. Il rig si ricostruisce al volo mantenendo posizione e animazioni.
- **Stereo affiancato** (`Y`): due viewport con camere separate di 6,5 cm, per visori o visione incrociata.
- **Erba a istanze** intorno al giocatore: fino a 180.000 ciuffi con lame sottili, dimensioni variabili e sterpaglia alta in macchia e sui margini rurali (densità legata al preset, strade ed edifici esclusi).
- **Personaggio con scheletro**: rig umanoide a 21 ossa, clip idle/camminata/corsa e due clip additive (salto e caduta) sommate alla camminata. Testa a misura umana con zigomi, palpebre, occhi con iride e pupilla, capelli con attaccatura sulla fronte, colletto, cintura, polsini, bottoni, tasche e lacci; pelle e tessuto con normal map procedurali.
- **Radar satellite reale** in minimappa e mappa grande, con strade OSM evidenziate sopra la foto aerea (`V` per passare alla mappa vettoriale).
- **Strade** ricostruite da OpenStreetMap e drappeggiate sul rilievo (asfalto e sterrati, larghezze per tipo), con curve **smussate in continuo** (`smoothPolyline`), tratteggio di mezzeria, **attraversamenti pedonali** con linea di arresto, marciapiedi larghi 1,15–1,45 m e **cordolo a 18 cm** con faccia verticale.
- **Segnaletica e arredo urbano**: STOP, dare precedenza e limite 50 su palo zincato (facce disegnate su canvas, nessun asset), panche in legno e ferro.
- **Illuminazione pubblica**: lampioni ogni ~32 m sulle strade asfaltate dei paesi, con braccio verso la carreggiata e vetro emissivo; di notte 7 luci puntuali seguono i lampioni più vicini alla camera.
- **Paesi** con edifici estrusi dalle impronte OSM, **tetti a falde** (padiglione) in laterizio, **facciate con finestre, persiane e davanzali**, fasce marcapiano, cantonali d'angolo, grondaie e portoni con stipiti e soglia, altezze stimate o da tag.
- **Montagne oltre il DEM**: una cintura di rilievi a bassa risoluzione (`src/world/far-terrain.ts`, una mesh e una draw call) continua il paesaggio oltre i 1,5–3,1 km di terreno caricato. Dentro il mondo usa **le stesse quote del DEM**, fuori cresce con rumore frattale a creste: niente più orizzonte tagliato dalla nebbia.
- **Boschi, uliveti e filari**: 14.000 alberi instanziati in modo deterministico (stesso seed → stesso paesaggio), con filari lungo le strade e alberi sparsi su campi e crinali per dare profondità alle distanze. Se `public/geo/canopy.bin` (ETH 10 m) è presente, l'altezza della chioma scala gli alberi e dirada quelli che il satellite non vede; senza il file si torna al comportamento OSM.
- **Ponti e guardrail**: i tratti OSM `bridge` hanno un impalcato con sponde in cemento e guardrail; la stessa quota è letta dalla fisica, quindi l'auto non passa più sotto il ponte. I guardrail compaiono anche sul lato a valle delle strade di campagna e diventano ostacoli solidi (preset medium+; spenti in minimal/low).
- **Casali di campagna**: fuori dal paese, lungo le strade rurali, compaiono **masserie, rimesse e ulivi/frutteti** dai GLB del kit (18 case, 11 rimesse e 46 alberi ad alta qualità). La posizione è deterministica e ogni impronta entra nell'indice delle collisioni **prima** di vegetazione ed erba: niente ci passa attraverso e niente ci cresce dentro.
- **Acqua**: torrenti e specchi d'acqua.
- **Camminata** in prima/terza persona con collisioni contro gli edifici, corsa, salto.
- **Guida simulata**: cambio automatico a 4-8 marce (o una sola per le elettriche) con strappo e kickdown, curva di coppia/potenza del motore vero, aderenza che limita la partenza (pattinamento), freni da 8,8-18 m/s², retromarcia inserita col freno, pendenza, off-road più lento e freno a mano. HUD con marcia e giri motore.
- **Vernice delle auto**: la carrozzeria dei GLB viene riconosciuta per materiale (`carpaint`, `Body_Color`, `punto-body`…), portata a vernice fisica (clearcoat 1,0) e **tingibile** senza colorare vetri, gomme e cerchi. I modelli che hanno il colore cotto nella texture (Audi R8 blu, Defender grigio) ricevono la tinta nello shader, così il dettaglio resta e il colore non diventa nero. Saturazione della vernice regolabile dalle impostazioni (82% = colore da auto vera). Di notte si accendono anche fari e fanalini dei GLB.
- **Itinerario scegliendo dalla mappa** (`M`, poi click): percorso più breve sulla rete stradale OSM, distanza e tempi stimati a piedi e in auto, linea in mappa e colonna luminosa sulla destinazione. `X` annulla.
- **Minimappa** e **mappa grande** dei cinque comuni, con strade, boschi e toponimi.
- **HUD** in italiano: velocità, coordinate, quota, fps, suggerimenti contestuali.
- **Offline-friendly**: i dati vettoriali, il DEM e il mosaico Sentinel-2 sono nel repo; solo le immagini di dettaglio arrivano dalla rete (con la base Sentinel che copre comunque ogni chunk).

## Economia, denaro virtuale e attività di Palata

> **Gli euro del gioco sono una valuta fittizia interna al videogioco.** Non sono denaro reale, non hanno valore monetario, non sono collegati a carte, conti, IBAN, gateway o servizi finanziari, e nessun acquisto nel gioco richiede un pagamento esterno. Le attività commerciali possono corrispondere a luoghi di Palata, ma il personaggio compra prodotti e servizi **simulati**: il gioco non invia ordini, prenotazioni o pagamenti ai locali.

- **Portafoglio** (`I` o clic sul saldo in alto): contanti virtuali (500 € iniziali) e conto virtuale (2.000 € iniziali), più lo storico dei movimenti con giorno e ora di gioco.
- **Acquisti atomici**: ogni acquisto mostra prima costo e saldo residuo; se i fondi virtuali non bastano il saldo e lo storico restano invariati. Gli importi sono interi in centesimi.
- **ATM simulato**: versamenti e prelievi spostano denaro solo tra contanti e conto virtuali e conservano il totale.
- **Luoghi**: catalogo in `src/sim/venue-catalog.ts`, usato da mappa, minimappa, interazione e menu. Ogni voce ha stato di verifica esplicito (`needs-review`, `simulated`), fonte, data e nota. **Nessun luogo è oggi `verified`**: i nomi sono piste di ricerca, le posizioni nel gioco sono approssimative e i prezzi sono inventati per il gameplay.
- **Menu**: i prodotti sono dati di gioco con effetti su fame/energia/divertimento; nel negozio di abbigliamento gli acquisti cambiano l'outfit del personaggio.

Dettagli e stato reale delle funzionalità: [docs/LIFE_SIMULATOR.md](docs/LIFE_SIMULATOR.md) e [docs/ROADMAP.md](docs/ROADMAP.md).

## Realismo: come avviciniamo la realtà

L'obiettivo è semplice: girare per Palata e dintorni e riconoscere i posti. Non c'è nessun
"reverse engineering" di GTA V: il lavoro è tutto sui **formati aperti** (tile Web Mercator,
DEM Terrarium, tag OSM) e su come renderli credibili in un motore proprio.

- **Foto aeree progressive.** Ogni chunk parte dal **mosaico Sentinel-2 locale** (CC BY 4.0)
  e chiede poi il dettaglio giusto per la distanza: z18 entro 500 m (tetti, uliveti,
  muretti), z17 fino a 3200 m, z16 oltre. Avvicinandosi, il chunk viene **riaffinato**
  senza essere ricostruito.
- **Rilievo che si vede.** Le normal map sono generate dal DEM (128×128 per chunk): anche
  dove la mesh è più grossolana del dato, il sole radente fa emergere crinali e fossi.
- **Luce e foschia.** Sole a 27°, ombre morbide, esposizione ACES tarata sul terreno e
  nebbia spostata più lontano. La cupola del cielo viene scalata a parte (`skyRadiance`):
  il cielo resta un gradiente blu invece di un muro bianco, che era la vera causa
  dell'abbagliamento.
- **Antialiasing vero, non un filtro sopra.** Dal preset *media* in su il gioco disegna
  dentro il composer, quindi l'antialias del canvas non basta: i render target hanno
  **MSAA 4×** (2× in *bassa*), sopra passa **SMAA** per gli spigoli sottili e per il
  fogliame ritagliato, e un **unsharp** leggero restituisce nitidezza senza rimettere gli
  scalini. Erba, fiori e chiome usano `alphaToCoverage`, così il contorno delle foglie è
  una transizione morbida invece di una scaletta di pixel verdi. Le ombre sono **PCF morbido**.
- **Post-processing.** Bloom morbido su cielo e tetti, SSAO in *alta*/*ultra* e OutputPass
  per tone mapping/color space corretti; si spegne da solo sui preset più leggeri.
- **Pioggia, neve e foschia.** Le gocce sono segmenti inclinati dal vento; i fiocchi sono
  sprite con gradiente morbido e dimensione per particella; la pioggia lascia **anelli di
  schizzo** sulla superficie vera (asfalto compreso); banchi di **foschia bassa** ancorati
  al terreno si addensano all'alba, al tramonto, con la nebbia e con la pioggia. Gli spunti
  vengono dagli esempi Three.js `webgpu_compute_particles_rain`,
  `webgpu_compute_particles_snow`, `webgpu_custom_fog` e `webgl_geometry_terrain`, riscritti
  in WebGL classico per girare anche sui PC più modesti.
- **Animazione del personaggio a pesi continui.** Idle, camminata e corsa si fondono in base
  alla velocità reale (smoothstep + rinormalizzazione), invece di scattare tra tre stati;
  il passo accelera con la velocità. È lo schema dell'esempio
  `webgl_animation_skinning_blending`.
- **Texture PBR vere.** Asfalto, intonaco, pietra, mattoni, coppi, erba e corteccia sono
  texture **CC0** (Poly Haven/ambientCG) in `public/textures/`, con normal e roughness;
  usura, giunti e grana procedurale si aggiungono sopra (vedi `public/textures/ATTRIBUTION.md`).
- **Meteo e sole veri.** Con `Meteo reale` attivo il gioco legge le condizioni attuali da
  Open-Meteo (open source, senza chiave) e calcola il sole in locale con la formula NOAA:
  elevazione e azimut cambiano con l'ora e con il punto in cui ti trovi, quindi alba e
  tramonto sono quelli del giorno. La copertura nuvolosa diventa una cupola procedurale,
  la pioggia/neve particelle intorno alla camera, la foschia cambia con visibilità e
  precipitazioni. Il dato si aggiorna ogni 10 minuti; se la rete manca resta attivo il
  sole reale e l'ultimo meteo disponibile.
- **Audio procedurale.** Motore con cilindri e regimi veri della scheda in uso (V12, V8,
  quattro cilindri…), rotolamento, vento, passi e uccelli sintetizzati con WebAudio,
  senza file audio; parte al primo click e si spegne con `N`.
- **Qualità scalabile su ogni PC.** Cinque preset (**compatibilità**, bassa, media, alta,
  ultra) scelti in automatico dalla GPU reale (`WEBGL_debug_renderer_info`): un PC con
  grafica integrata parte in bassa, un portatile molto vecchio o il rendering software in
  **compatibilità**, una GPU dedicata in alta. Il preset non cambia solo la risoluzione:
  decide ombre, erba, alberi, pedoni, arredo, meteo e dettaglio delle facciate. Se gli fps
  restano bassi il gioco riduce **prima ombre, zoom satellite e raggio di streaming**,
  mantenendo erba e meteo, e solo dopo la risoluzione: abbassare i pixel per primo è il modo più rapido per riempire lo schermo di
  scalini. Sopra i 12 milioni di pixel (4K con DPR 2) l'immagine viene comunque limitata,
  perché nessuna GPU da browser li regge a 60 fps; `G` (o le impostazioni) cambia preset.
- **Radar vero, con scala automatica.** La minimappa (320 px) disegna le tile raster aperte configurate intorno
  al giocatore con lo **zoom scelto perché un pixel di tile copra un pixel di schermo**
  (z18 da vicino, z14 quando è larga), le strade OSM in crema sopra, la barra di scala e
  l'etichetta del paese più vicino con la distanza. La scala è **300 m a piedi** e si apre
  in auto con la velocità (240 m da fermo, ~660 m a 100 km/h): a 90 km/h si vede la curva
  dopo. La rotella sopra la mappa stringe o allarga (0,45×–2,4×) e resta dove lo lasci.
  Sul bordo compaiono direzione e chilometri di **Termoli, Larino, Campobasso, Montenero
  di Bisaccia, San Salvo e Vasto**. La mappa grande parte dal mosaico Sentinel locale;
  le tile aperte configurate forniscono il dettaglio remoto. `V` alterna satellite e mappa
  vettoriale, `M` apre la mappa grande.
- **Dati locali.** DEM, OSM e mosaico Sentinel sono pre-processati nel repo: il mondo parte
  anche senza rete. Solo le tile di dettaglio arrivano dal provider (e se mancano resta la
  base Sentinel, non un prato verde).

## Stack e perché

| Scelta | Motivo |
| --- | --- |
| **TypeScript + Vite** | build veloce, zero framework, tipi stretti sul motore geografico |
| **Three.js (WebGL)** | streaming di geometrie/texture, controllo fine su LOD e materiali, gira in qualsiasi browser |
| **Dati OSM + DEM pre-processati in JSON/binario** | avvio immediato, nessun database, nessun server |
| **Fisica custom (niente engine)** | per camminata e auto arcade serve poco: meno peso, più controllo, testabile |
| **Vitest** | test puri su proiezioni, heightfield, indici spaziali e modello dell'auto |

## Avvio

Requisiti: Node.js ≥ 22, un browser con WebGL2.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
```

I dati geografici sono già committati in `public/geo/`. Per rigenerarli (o cambiare area):

```bash
npm run geo              # scarica OSM + DEM e riscrive public/geo/
npm run geo -- --skip-dem
npm run geo -- --skip-osm
npm run geo:audit        # controlla copertura, km, ponti, pendenze e tag OSM
npm run canopy           # ritaglia ETH Canopy Height 10 m → public/geo/canopy.bin
npm run landcover        # WorldCover + OSM → public/geo/landcover/ (ignorata da git)
```

> Overpass a volte è saturo: lo script divide l'area in 16 riquadri, ruota i mirror e ritenta. Se un riquadro viene perso, rilancia `npm run geo -- --skip-dem`.

Il dataset di copertura del suolo è opzionale ma è quello che dà al paesaggio i
colori e la grana di coltivo, prato, bosco e roccia: senza, il terreno resta
sulla sola foto satellitare. La prima esecuzione scarica circa 41 MB di
WorldCover 10 m (CC BY 4.0) e richiede qualche minuto.

### Comandi

| Tasto | A piedi | In auto |
| --- | --- | --- |
| `W A S D` | muoviti | accelera / sterza / frena-retro |
| `Shift` | corri | spinta (più aderenza e velocità massima) |
| `Spazio` | salta | freno a mano (spegne l'autopilota) |
| `F` | entra in auto (se vicino) | scendi |
| `E` | entra nell'attività vicina / dormi e salva a casa | +2 ore (ciclo giorno/notte) |
| `Q` | meteo successivo | meteo successivo |
| `,` `.` | — | freccia sinistra / destra |
| `J` | — | fari accesi anche di giorno |
| `O` | — | autopilota di strada |
| `I` | portafoglio virtuale e movimenti | portafoglio virtuale e movimenti |
| `C` | prima/terza persona | inseguitrice → alta → cofano |
| `M` | mappa grande (click = itinerario) | mappa grande (click = itinerario) |
| `X` | annulla l'itinerario | annulla l'itinerario |
| `V` | radar satellite / mappa | radar satellite / mappa |
| `G` | qualità grafica (compatibilità → bassa → media → alta → ultra) | qualità grafica |
| `B` | cambia veicolo | cambia veicolo |
| `T` | imposta la casa più vicina come garage (segnalibro in mappa) | come a piedi |
| `L` | torna al garage (auto parcheggiata lì) | come a piedi |
| `K` | colore auto successivo | colore auto successivo |
| `P` | impostazioni: meteo, ora, veicolo, colore, personaggio, garage | impostazioni |
| `Y` | stereo affiancato | stereo affiancato |
| `N` | audio on/off | audio on/off |
| `H` | mostra/nascondi aiuto | — |
| `R` | riporta in strada | riporta in strada |
| mouse | guarda intorno (click per bloccare il puntatore) | orbita la telecamera |
| rotella | — | allontana/avvicina la telecamera |
| rotella sulla minimappa | stringe/allarga la mappa | come a piedi |

URL utili: `?autostart=walk` e `?autostart=drive` saltano il menu (usati dallo smoke test); `?at=lat,lon` fa partire il giocatore in un punto preciso (utile per provare lo streaming fuori dal bbox).

### Prova dei bundle geografici (senza endpoint esterno)

Il repo include un server demo con **un tile sintetico** appena a nord del bbox: una strada, un incrocio e quattro case. Non è geografia reale, serve solo a vedere rendering e collisioni.

```bash
# terminale 1: bundle demo su http://127.0.0.1:5180
npm run world:demo

# terminale 2: Vite in modalità demo (legge .env.demo)
npm run dev:demo
```

Poi apri:

```text
http://127.0.0.1:5173/?quality=ultra&autostart=walk&at=41.9237,14.7975
```

Lo spawn è **dentro** il bbox locale (dove c'è la satellite imagery vera) e guarda verso nord: strada e case sintetiche cominciano pochi metri fuori dal bbox, quindi si vedono senza perdere la mappa reale. Le case bloccano giocatore e auto; la strada alza il piano calpestabile di 20 cm e accende l'indicatore `onRoad`. Dalla console `moliseGame.streamedWorld?.stats` mostra tile, strade ed edifici attivi.

Per un endpoint reale, crea `.env.local` da `.env.example` e imposta `VITE_OPEN_WORLD_DATA_TILE_URL` (template `{z}/{x}/{y}`) e `VITE_OPEN_WORLD_DATA_ATTRIBUTION`. I bundle fuori dal DEM locale vengono disegnati e indicizzati; quelli dentro il bbox sono ritagliati perché lì comanda OSM locale.

## Verifica

```bash
npm test          # proiezione, DEM, OSM, fisica auto, itinerari, tetti, sole e meteo
npm run build     # typecheck + build di produzione
npm run preview   # serve dist/ su :4173
npm run smoke     # Chrome headless: carica, guida, cammina, itinerario, controlla il PNG
npm run check:cars # legge i GLB delle auto: unità, proporzioni, pezzi staccati

node scripts/capture.mjs --out captures/x --quality high --hour 15   # scatti riproducibili del mondo
node scripts/shot.mjs --url "http://127.0.0.1:5173/harness.html?view=head" --out captures/head.png --ready __harnessReady
```

`harness.html` è una pagina di ispezione a parte: carica i GLB dei personaggi e mostra tre umani su un prato neutro, in figura intera o in primo piano (`?view=head`), utile per controllare corpi e animazioni senza caricare il mondo (che con SwiftShader richiede minuti).

Lo smoke test apre Chrome headless via CDP, verifica l'assenza di errori in console, che l'auto si muova premendo `W`, che il giocatore cammini, e analizza lo screenshot (varianza e varietà di colore) per assicurarsi che il mondo sia davvero renderizzato. Salva `smoke/shot.png`.

## Struttura

```
src/
  config.ts            costanti del mondo, proiezione lat/lon -> x/z, tuning
  geo/
    geo.ts             matematica pura (mercator, poligoni, PRNG)
    elevation.ts       heightfield DEM + campionamento bilineare
    canopy.ts          altezza chioma ETH (fallback se il file manca)
    ground.ts          unica quota calpestabile (DEM + strada + ponte)
    osm.ts             tipi OSM, indici spaziali strade/edifici, collisioni
  world/
    chunks.ts          griglia dei chunk
    imagery.ts         streaming tile satellite -> texture per chunk (zoom progressivo)
    terrain.ts         mesh del terreno + LOD texture (z16/z17/z18)
    roads.ts           nastri stradali drappeggiati, ponti, cordoli + acqua
    guardrails.ts      guardrail su ponti e scarpate (con collisione)
    buildings.ts       estrusione edifici + falde del tetto + UV delle facciate
    roof.ts            geometria pura del tetto a padiglione (testata)
    vegetation.ts      alberi instanziati nei boschi
    surface-textures.ts texture procedurali (asfalto, sterrato, intonaco, coppi)
    weather.ts         meteo Open-Meteo, posizione reale del sole, auto-refresh
    clouds.ts          cupola di nuvole procedurali guidata dalla copertura
    precipitation.ts   pioggia, neve soffice e schizzi sul terreno
    mist.ts            banchi di foschia bassa ancorati al terreno
    citykit.ts         caricamento, normalizzazione e istanze dei GLB del kit
    city-props.ts      arredo del paese e della campagna (alberi, siepi, auto)
    farmsteads.ts      casali, rimesse e alberi da campo + impronte di collisione
    grass.ts           campo d'erba instanziato che segue il giocatore
    property.ts        casa/garage scelto sulle impronte OSM + segnalibro
    pedestrians.ts     pedoni umani che camminano sui marciapiedi OSM
    sky.ts             cielo, sole, ombre
    car-library.ts     auto di serie: GLB, normalizzazione, vetri e ruote
  environment/
    sun-clock.ts       sole per un'ora locale arbitraria + preset meteo
  garage.ts            import GLB, specifica automatica e IndexedDB
  entities/
    player.ts          controller a piedi; usa il corpo umano GLB (fallback: rig procedurale)
    human-model.ts     corpi rigged, blend idle/camminata/corsa, istanze clonate
    appearance.ts      sesso, altezza, corporatura, carnagione, capelli, outfit
    vehicle.ts         veicoli procedurali o GLB + assetto, tinta e ruote
  sim/
    car.ts             fisica pura e testabile: motore, cambio, freni, aderenza
    vehicle-catalog.ts 30 veicoli, tutti su GLB dell'archivio cars.zip
    routing.ts         grafo stradale + A* per l'itinerario scelto sulla mappa
    economy.ts         economia virtuale: contanti, conto, acquisti atomici, movimenti
    needs.ts           fame, energia, divertimento: calo nel tempo ed effetti
    venue-catalog.ts   luoghi e attività di Palata + menu di gioco simulati
    save.ts            salvataggio della modalità vita (versione, convalida, orologio)
  ui/
    hud.ts             HUD, impostazioni e schermate
    minimap.ts         minimappa + mappa grande (radar satellite o vettoriale)
    satellite.ts       tile raster configurabili e mosaico z14 per la mappa grande
  gfx/
    post.ts            bloom + SMAA + OutputPass (post-processing opzionale)
    quality.ts         preset minimal/low/medium/high/ultra + auto-detect GPU
  audio/
    audio.ts           WebAudio procedurale: motore per modello, vento, passi, uccelli
  game.ts              orchestrazione, input, camera, loop
scripts/
  fetch-geodata.mjs    download e preprocessing OSM/DEM
  fetch-canopy.mjs     ritaglio ETH Canopy Height 10 m sul bbox
  geo-audit.mjs        controllo copertura, strade, ponti e pendenze
  smoke.mjs            test end-to-end con Chrome headless
  check-street-imagery.mjs  censimento copertura Mapillary sul bbox (richiede token)
```

## Dati e licenze

- **OpenStreetMap** — strade, edifici, aree, toponimi: © OpenStreetMap contributors, licenza **ODbL 1.0**. `public/geo/osm.json` è un'opera derivata: se lo ridistribuisci, resta ODbL.
- **AWS Terrain Tiles (Terrarium)** - DEM SRTM/Copernicus/NASADEM: dati aperti, vedi [registry.opendata.aws/terrain-tiles](https://registry.opendata.aws/terrain-tiles/).
- **ETH Global Canopy Height 2020** - altezza della chioma a 10 m usata per la vegetazione (`public/geo/canopy.bin`): Lang, Jetz, Schindler & Wegner (2023), **CC BY 4.0**, [globalcanopyheight](https://langnico.github.io/globalcanopyheight/). Il tile originale resta in `.geo-cache/canopy/`.
- **Sentinel-2 cloudless 2025** — mosaico satellitare dell'intera area (`public/geo/world-imagery.jpg`): © EOX IT Services GmbH, licenza **CC BY 4.0**, contiene dati Copernicus Sentinel modificati ([s2maps.eu](https://s2maps.eu)). Si rigenera con `npm run geo:imagery`.
- **Immagini satellitari** — il mosaico Sentinel-2 locale è © EOX IT Services GmbH, **CC BY 4.0**. Il provider raster remoto è disattivato per impostazione predefinita per evitare fonti con licenza proprietaria o condizioni di utilizzo non verificate. Per tile provenienti da un servizio aperto e autorizzato, configurare `VITE_OPEN_IMAGERY_TILE_URL` (template XYZ con `{z}/{x}/{y}`) e `VITE_OPEN_IMAGERY_ATTRIBUTION`; il servizio va ospitato o scelto nel rispetto della sua licenza e dei suoi limiti.
- **Cache raster offline** — tile aperte scaricate salvate nella Cache API del browser (massimo 2.048 tile, FIFO). Per configurare un endpoint XYZ self-hosted, copiare `.env.example` in `.env.local` e impostare URL e attribuzione.
- **Bundle geografici XYZ (sperimentale)** — `VITE_OPEN_WORLD_DATA_TILE_URL` accetta un template HTTPS/HTTP con `{z}/{x}/{y}` e `VITE_OPEN_WORLD_DATA_ATTRIBUTION` è obbligatoria. Il servizio deve fornire JSON `schemaVersion: 1` con indirizzo tile, attribuzione, `roads`, `buildings` e una griglia DEM opzionale (`minLon`, `maxLon`, `minLat`, `maxLat`, `width`, `height`, `encoding: "int16-decimeters"`, `values`). Il runtime scarica le tile vicine tramite la cache, applica il DEM al terreno e disegna strade ed edifici **fuori dal bbox locale**; le stesse feature entrano negli indici di collisione e nella quota calpestabile. Le parti dentro il DEM locale sono ritagliate via per non duplicare OSM. Ogni feature è disegnata solo dal tile del suo primo punto, così i bundle possono ripeterla su più tile. Lo streaming si spegne sui preset `minimal`/`low` e richiede l'endpoint configurato. L’endpoint va ospitato o usato nel rispetto della licenza, dell’attribuzione e dei limiti del servizio. Questa fase usa ancora le coordinate locali equirettangolari del gioco: non abilita la navigazione accurata globale.
- **Immagini stradali (opzionale)** — non ancora usate. `npm run streets` conta quante strade dei cinque comuni hanno una foto entro 50 m: interroga **Panoramax** (API pubblica, nessun account) e, se impostato `MAPILLARY_TOKEN` (gratuito, CC BY-SA 4.0), anche Mapillary. Al 21/10/2026 Panoramax non ha foto nel bbox: la copertura Mapillary è l'unica da verificare.
- **Meteo** — Open-Meteo, dati CC BY 4.0, senza chiave API. Usato solo se attivi
  "Meteo reale"; il sole è calcolato in locale e non dipende dal servizio.
- **Personaggi** — corpi e animazioni da [Ready Player Me Animation Library](https://github.com/readyplayerme/animation-library):
  corpi di riferimento `Masculine_TPose` / `Feminine_TPose` e clip di motion capture
  (idle, camminata, corsa). La licenza concede uso personale e commerciale **con avatar
  Ready Player Me**, vieta di ridistribuire le animazioni come asset a sé stanti.
  Dettagli in `public/models/ATTRIBUTION.md`.
- **City kit (threejsassets.com)** — 38 modelli free del pack *Realistic City* e dei pack
  low-poly (strade, arredo, alberi, case coloniche, auto). Licenza **Free Commercial**:
  i file non sono versionati e si rigenerano con `npm run kit`. Dettagli e tabella ruoli in
  `docs/CITYKIT.md`.
- **Auto di serie su GLB** - 30 modelli forniti dal proprietario in `public/cars/`. I binari restano fuori da git (`.gitignore`); il manifest `public/cars/manifest.json` è versionato e descrive slug, file, yaw e lunghezza. Titoli, autori, URL e licenze sono in `ATTRIBUTION.md`: cinque modelli sono fuori dalla lista di 25 crediti e quattro usano **Sketchfab Standard**, quindi non sono ridistribuibili.
  restano fuori da git (`.gitignore`); il manifest `public/cars/manifest.json` è versionato
  una distribuzione pubblica.**
- **Codice** — MIT (vedi `LICENSE`).

GTA è un marchio dei rispettivi proprietari. Questo progetto non è affiliato né approvato da Rockstar Games e non contiene materiale del gioco.

## Cosa manca (onesto)

- **Personaggi**: il corpo è umano vero (skin, texture, mocap), ma esistono **due soli
  corpi base** — un uomo e una donna. Volti e vestiti sono dipinti nella texture, quindi
  tutte le persone dello stesso sesso hanno la stessa faccia e lo stesso paio di jeans:
  la varietà viene da altezza, corporatura e tinta. Per popolazioni diverse servono altri
  avatar; le opzioni di carnagione/capelli/outfit nelle impostazioni non cambiano più il
  modello (cambiano ancora sesso, altezza e corporatura).
- **Alberi**: le chiome sono card di foglie, non volumi; da vicino si nota.
- **Terreno da vicino**: la foto satellite resta piatta, il dettaglio è solo colore.
- **Prestazioni**: 14.000 alberi × 3 mesh + 82.000 ciuffi + 12.000 quad di tappeto
  pesano su GPU integrate; prima di alzare ancora i numeri serve un LOD per distanza.
- **Pedoni**: ci sono (6–18 a seconda della qualità), ma camminano solo sui marciapiedi
  delle strade asfaltate: niente attraversamenti, niente dialoghi, niente folla in piazza.
- **Traffico**: non c'è; le altre auto in strada sono ancora un desiderio.
- **Mondo oltre il bbox**: strade ed edifici streamed funzionano, ma le coordinate restano equirettangolari locali. Per una navigazione precisa a scala globale serve un floating origin (o coordinate geocentriche con rebasing), ancora da progettare.

## Idee per il prossimo giro

- altri corpi/volti (o una texture per capo) per rompere il clone dei pedoni;
- LOD per alberi e ciuffi d'erba, così si può alzare la densità senza perdere fps;
- traffico con percorsi sulle strade OSM;
- collisioni auto più fini (OBB invece del cerchio);
- cache delle tile su IndexedDB, per rigiocare offline dopo il primo giro;
- dettaglio procedurale a terra (muretti a secco, staccionate, ulivi più vicini);
- espansione della mappa (Termoli, Larino, Montenero di Bisaccia);
- supporto mobile con joystick virtuale.

---

Fatto con calma, dati aperti e un po' di nostalgia per i giochi di una volta.
