# Riserve del world kit — TODO

Stato al **29 ottobre 2026**. Le 26 riserve sono già in `public/worldkit/` e nel
manifest, ma `loadWorldKit()` non le carica: non pesano su VRAM, memoria o tempo
di avvio. Questo file è la coda di lavoro per trasformarle in oggetti di gioco
senza rompere i preset, le licenze o i budget.

## Regole prima di caricarle

1. **Non cambiare `usage: "reserve"` in `"placed"` senza una voce qui e un test.**
   Il manifest è la fonte unica: il caricatore filtra per ruolo, non per nome.
2. **Licenza**: quasi tutte sono CC BY 4.0 (attribuzione obbligatoria). Fanno
   eccezione `passerella` e `strada-innevata` (CC BY-SA 4.0: l'opera derivata
   deve restare con la stessa licenza) e `via-s-gemini` (CC BY-NC 4.0: **non
   usabile in una build commerciale**). Ogni nuovo uso va aggiunto ad
   `ATTRIBUTION.md` con titolo, autore e fonte esatti.
3. **Geometria**: alcune riserve hanno estensioni non realistiche (il manifest
   dichiara 78 km per `terreno`, 867 m per `palo-elettrico`). Vanno riprocessate
   con `scripts/import-world-glb.mjs` o decimate prima del piazzamento.
4. **Budget**: una riserva pesante non entra nel world kit globale. Meglio un
   ruolo a caricamento lazy, un limite per preset e una distanza di culling.
5. **Un ruolo, un comportamento**: `ground`, `curb`, `sidewalk`, `guardrail`,
   `streetlight`, `vfx` sono ruoli nuovi da aggiungere a `WorldRole` quando la
   prima riserva di quel gruppo sarà pronta.

## Coda prioritaria

### P0 — arredo stradale leggero (si può fare subito)

| Slug | Nome | Autore | Licenza | Ingombro (m) | Tri | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| `guardrail` | Guardrail | danimow | CC-BY-4.0 | 0.5 × 0.8 × 10.0 | 524 | Modulo da 10 m, il candidato migliore: istanziabile lungo le provinciali. |
| `guardrail-e-terminale` | Guardrail e terminale | xplanepilot | CC-BY-4.0 | 4.3 × 1 × 0.4 | 2.936 | Chiude le estremità del guardrail; stesso ruolo. |
| `cordolo-in-pietra` | Cordolo in pietra | NScans | CC-BY-4.0 | 2.8 × 0.3 × 0.1 | 9.587 | Cordolo da 2,8 m: entra nel ruolo `curb`, non nel terreno. |
| `marciapiede-8-m` | Marciapiede 8 m | SPLEEN VISION | CC-BY-4.0 | 1.5 × 0.2 × 8.1 | 11.514 | Marciapiede fotografato: va allineato al bordo strada e alla quota `RoadIndex`. |
| `marciapiede-lungo` | Marciapiede lungo | SPLEEN VISION | CC-BY-4.0 | 1.0 × 0.2 × 6.1 | 11.512 | Variante stretta; usare una sola delle due per non raddoppiare le draw call. |
| `lampione` | Lampione | cimon | CC-BY-4.0 | 1.3 × 7 × 2.3 | 6.640 | Luce vera da agganciare a `streetLights`; non basta il modello. |
| `lampione-da-sentiero` | Lampione da sentiero | Skipperino | CC-BY-4.0 | 2.8 × 4 × 2.8 | 840 | Leggero, buono per i sentieri e le piazze. |
| `palo-della-luce` | Palo della luce | joeynaja | CC-BY-4.0 | 3.2 × 6 × 0.5 | 326 | Il più leggero; palo senza apparecchio, da abbinare a un punto luce. |

### P1 — suolo e prato (il “livello sotto il satellite”)

| Slug | Nome | Autore | Licenza | Ingombro (m) | Tri | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| `terreno-fng` | Terreno (FNG) | FNG | CC-BY-4.0 | 4 × 8 × 4 | 28.782 | Zolla 4 × 4 m, troppo densa per un tappeto: usarla come decal di primo piano o decimare. |
| `terreno-grande` | Terreno grande | Dogus Berk Bayram | CC-BY-4.0 | 2.500 × 12 × 2.000 | 28.791 | Una sola mesh da 2,5 × 2 km: non è sovrapponibile al DEM senza un reprojection; buona solo come sfondo lontano. |
| `grass-tile-a` | Zolla d’erba fitta | Epic_Tree_Store | CC-BY-4.0 | 1.6 × 0.8 × 2.8 | 82.943 | Hero asset: 83k tri per 4 m², massimo poche istanze vicino alla camera. |
| `grass-tile-b` | Zolla d’erba rada | Epic_Tree_Store | CC-BY-4.0 | 1.5 × 0.7 × 1.2 | 18.307 | Variante più leggera, ancora troppo pesante per un campo intero. |
| `terreno` | Terreno | DJMaesen | CC-BY-4.0 | 78.636 × 8 × 78.636 | 23.038 | Estensione assurda: il modello va riprocessato/normalizzato prima di qualunque uso. |
| `terreno-di-strada` | Terreno di strada | jimbogies | CC-BY-4.0 | 12.006 × 3 × 6.962 | 5.936 | Striscia da 12 km: buona per un fondale, non per il terreno giocabile. |
| `tracce-nel-fango` | Tracce nel fango | SPLEEN VISION | CC-BY-4.0 | 4.5 × 3 × 4.9 | 32.709 | Meglio estrarne una texture di decal che istanziare 33k tri per impronta. |

> La fisica usa già la classificazione `landcover` (`dirt` / `grass` / `rock`)
> e lo shader del terreno ha la grana fotografica per classe. Queste riserve
> servono al **dettaglio vicino**, non a sostituire il terreno: l'ordine giusto
> è prima il decal a basso costo, poi il GLB solo dove la camera è a pochi metri.

### P2 — vegetazione e atmosfera

| Slug | Nome | Autore | Licenza | Ingombro (m) | Tri | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| `scena-di-bosco` | Scena di bosco | Nicholas-3D | CC-BY-4.0 | 87 × 15 × 54 | 43.317 | Macchia completa: usarla come quinta lontana o scomporla in alberi/cespugli. |
| `clover-planter` | Fioriera di trifoglio | 3dhdscan | CC-BY-4.0 | 0.6 × 0.5 × 0.6 | 8.160 | Arredo di piazza, non vegetazione di campo. |
| `cerchi-di-pioggia` | Cerchi di pioggia | VRA | CC-BY-4.0 | 963 × 0.5 × 962 | 84 | VFX: va nel sistema meteo, non nel world kit statico. |
| `neve-che-cade` | Neve che cade | Elin | CC-BY-4.0 | 15.7 × 3 × 15.2 | 1.800 | VFX: stesso discorso; particelle, non mesh da piazzare. |

### P3 — casi speciali, da trattare con attenzione

| Slug | Nome | Autore | Licenza | Ingombro (m) | Tri | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| `palo-elettrico` | Palo elettrico | Cau Hi | CC-BY-4.0 | 98.6 × 9 × 867.4 | 7.861 | Ingombro non credibile: probabilmente contiene più pali/linee; separare i nodi. |
| `cordolo-scan` | Cordolo scan | LordSamueliSolo | CC-BY-4.0 | 248 × 0.3 × 372 | 290.522 | Scan enorme e pesantissimo: decimare o estrarre un modulo da 2–3 m. |
| `protezione-stradale` | Protezione stradale | Safat_Rules | CC-BY-4.0 | 0.5 × 1.2 × 7.7 | 21.397 | Barriera pronta, ma 21k tri: solo su strade principali e con culling. |
| `chiesa-venezia` | Chiesa (Venezia) | rmass | CC-BY-4.0 | 16.1 × 18 × 15.7 | 28.798 | Landmark fuori contesto molisano: usarla solo se serve un edificio religioso generico. |
| `passerella` | Passerella | OrbArts | CC-BY-SA-4.0 | 47.1 × 1 × 47.1 | 11.517 | **Share-alike**: l'eventuale opera derivata resta CC BY-SA 4.0. |
| `strada-innevata` | Strada innevata | Vlad | CC-BY-SA-4.0 | 18.7 × 4 × 29.1 | 576.662 | **Share-alike** e 577k tri: solo evento neve, con LOD dedicato. |
| `via-s-gemini` | Via S. Gemini | Andrea Spognetta (Spogna) | CC-BY-NC-4.0 | 42.4 × 8 × 13.2 | 32.329 | **Non commerciale**: esclusa dalla build commerciale e dai preset di default. |

## Ordine di lavoro consigliato

1. Aggiungere `WorldRole` `guardrail`, `curb`, `sidewalk`, `streetlight` e un
   caricatore lazy con budget per preset; partire da `guardrail` + `cordolo`.
2. Riprocessare i tre terreni (`terreno`, `terreno-di-strada`, `terreno-fng`) e
   decidere se il ruolo `ground` è un decal o una mesh; nel frattempo la fisica
   e la grana del terreno coprono già il bisogno.
3. Estrarre da `tracce-nel-fango` una texture di decal (niente 33k tri per
   impronta) e collegarla al sistema delle tracce di gomma.
4. Spostare `cerchi-di-pioggia` e `neve-che-cade` nel sistema meteo, non nel
   world kit.
5. Tenere `via-s-gemini` fuori dalla build commerciale; `passerella` e
   `strada-innevata` solo dopo una verifica legale della licenza share-alike.
