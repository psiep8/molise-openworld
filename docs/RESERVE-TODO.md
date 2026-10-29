# Riserve del world kit — TODO

Stato al **29 ottobre 2026**. Il world kit ha **181 modelli** (78,6 MiB): 161
caricati dai preset normali e 20 ancora `usage: "reserve"`. Le riserve restano
nel manifest e nel repository, ma `loadWorldKit()` non le scarica: non pesano su
VRAM, memoria o tempo di avvio.

## Cosa è stato chiuso

Le 26 riserve originali non sono più un blocco unico:

- **10 sono diventate oggetti di gioco** con ruoli veri (vedi tabella sotto);
- **1 è stata scartata** perché non decimabile in modo utile (`cordolo-scan`,
  ancora ~330k triangoli dopo la semplificazione: il modulo da 2,8 m non vale
  il costo);
- **15 restano riserve** (terreni enormi, VFX, landmark, share-alike).

In più sono entrati nel repository, come riserve o come arredo piazzato, i pack
stradali nuovi: `modular_city_road_pack`, `road_modular`, `road_signs_pack`,
`old_street_pack`, `road__highway`, `city_infrastructure_map_3`, i due ponti e
`tall_green_field`.

### Ruoli nuovi

`WorldRole` ora comprende `sidewalk`, `curb`, `guardrail`, `streetlight` e
`bridge`. Il caricatore li richiede di default (tranne `bridge`, che resta
riserva) e **salta sempre `usage: "reserve"`**, anche quando il ruolo
corrisponde: un ponte da 36k triangoli non deve entrare in un preset che non lo
piazza.

| Ruolo | Modelli piazzati | Dove finiscono |
| --- | --- | --- |
| `sidewalk` | `sidewalk-8m`, `sidewalk-long`, `sidewalk-module-a/b` | `world/roadside-kit.ts`, fuori dai tratti urbani |
| `curb` | `curb-stone`, `curb-modular-long/short` | stesso kit, appena fuori dal bordo strada |
| `guardrail` | `guardrail`, `guardrail-terminal`, `guardrail-heavy` | `world/guardrails.ts`, sulle stesse campate procedurali |
| `streetlight` | `streetlight-pole/lamp/dual/single` | `world/street-furniture.ts`, al posto dei pali procedurali |
| `grass-hero` | `grass-tile-a`, `grass-tile-b` | `world/world-props.ts` (`WorldGrass`), poche zolle fotogrammetriche entro 22 m |
| `bridge` | `bridge-modular`, `bridge-highway` | **riserva**: ruolo pronto, piazzamento non ancora fatto |

## Regole prima di caricare una riserva

1. **Non cambiare `usage: "reserve"` in `"placed"` senza una voce qui e un test.**
   Il manifest è la fonte unica: il caricatore filtra per ruolo, non per nome.
2. **Licenza**: quasi tutte sono CC BY 4.0 (attribuzione obbligatoria). Fanno
   eccezione `passerella` e `strada-innevata` (CC BY-SA 4.0: l'opera derivata
   deve restare con la stessa licenza), `via-s-gemini` e `bridge-highway`
   (CC BY-NC 4.0: **non usabili in una build commerciale**). Ogni nuovo uso va
   aggiunto ad `ATTRIBUTION.md` con titolo, autore e fonte esatti.
3. **Geometria**: alcune riserve hanno estensioni non realistiche (il manifest
   dichiara 78 km per `terreno`, 867 m per `palo-elettrico`). Vanno riprocessate
   con `scripts/import-world-glb.mjs` o decimate prima del piazzamento.
4. **Budget**: una riserva pesante non entra nel world kit globale. Meglio un
   ruolo a caricamento lazy, un limite per preset e una distanza di culling.
   Il manifest deve restare sotto i 90 MiB (oggi 78,6 MiB).

## Erba fotogrammetrica: `grass-hero`

- `grass-tile-a` (83k tri) e `grass-tile-b` (18k tri) sono due zolle scansite,
  alte 0,8/0,7 m e larghe 1,6×2,7 m dopo la normalizzazione. Non entrano nel
  tappeto procedurale (che usa varianti sotto i 2.500 triangoli), ma poche
  istanze a pochi metri dalla camera danno il dettaglio che i ciuffi low-poly
  non hanno.
- `WorldGrass.placeHeroGrass()` ne piazza `round(12 × grassDensity)` (0 su
  `minimal`, 5 a `medium`, 12 a `ultra`) entro 22 m, solo su prato/bosco, fuori
  da strade ed edifici, con pendenza locale sotto 0,55 m: il bordo della zolla
  non deve sollevarsi dal DEM.
- Sono attraversabili come l'erba normale (`pass-through`), ondeggiano col vento
  condiviso e non proiettano ombre. Costo misurato: cinque zolle a `medium`
  valgono ~0,4 M triangoli su ~45 M, sotto l'1% di fps.

## Arredo stradale: com'è collegato

- `buildRoadsideKit()` piazza marciapiedi e cordoli solo su strade asfaltate
  larghe almeno 4 m, **fuori** dai tratti con marciapiede procedurale
  (`walkSpans`), a 140–1900 m dalla casa, con pendenza sotto 16° e senza
  sovrapporsi a un'altra strada. Il manto procedurale resta l'unica superficie
  con quota, fisica e collisioni: i moduli GLB sono dettaglio del ciglio.
- I guardrail GLB sostituiscono il nastro procedurale sulle **stesse campate**;
  le collisioni vengono registrate prima, sulla geometria calcolata, quindi non
  cambiano. I materiali del kit sono condivisi e non vengono liberati al cambio
  preset (`userData.kit`).
- I lampioni GLB sostituiscono palo e lanterna procedurali quando il world kit è
  caricato; il pool di `PointLight` resta identico (`heightAt + 5,4 m`).
- Budget `roadside` per preset: `minimal`/`low` 0, `medium` 80, `high` 140,
  `ultra` 200 moduli. Misurato sul banco prova: a `medium` gli 80 moduli
  costano meno dell'1% di fps (21,1 → 21,3 fps sulla RX 580, entro il rumore).

## Coda prioritaria

### P1 — suolo e prato (il “livello sotto il satellite”)

| Slug | Nome | Autore | Licenza | Ingombro (m) | Tri | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| `terreno-fng` | Terreno (FNG) | FNG | CC-BY-4.0 | 4 × 8 × 4 | 28.782 | Zolla 4 × 4 m, troppo densa per un tappeto: usarla come decal di primo piano o decimare. |
| `terreno-grande` | Terreno grande | Dogus Berk Bayram | CC-BY-4.0 | 2.500 × 12 × 2.000 | 28.791 | Una sola mesh da 2,5 × 2 km: non è sovrapponibile al DEM senza una reprojection; buona solo come sfondo lontano. |
| `terreno` | Terreno | DJMaesen | CC-BY-4.0 | 78.636 × 8 × 78.636 | 23.038 | Estensione assurda: il modello va riprocessato/normalizzato prima di qualunque uso. |
| `terreno-di-strada` | Terreno di strada | jimbogies | CC-BY-4.0 | 12.006 × 3 × 6.962 | 5.936 | Striscia da 12 km: buona per un fondale, non per il terreno giocabile. |
| `tracce-nel-fango` | Tracce nel fango | SPLEEN VISION | CC-BY-4.0 | 4,5 × 3 × 4,9 | 32.709 | Meglio estrarne una texture di decal che istanziare 33k tri per impronta. |

> Il dettaglio vicino è coperto da `world/field-detail.ts`: zolle `ground`,
> accenti `field`, grano procedurale, fango e balle di paglia; a pochi metri
> dalla camera si aggiungono le zolle `grass-hero`. La fisica usa la
> classificazione `landcover` (`dirt` / `grass` / `rock`). Le riserve qui sopra
> servirebbero solo a sostituire le zolle attuali con scan ancora più pesanti:
> l'ordine giusto è prima il decal a basso costo, poi il GLB solo dove la camera
> è a pochi metri.

### P2 — vegetazione e atmosfera

| Slug | Nome | Autore | Licenza | Ingombro (m) | Tri | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| `scena-di-bosco` | Scena di bosco | Nicholas-3D | CC-BY-4.0 | 87 × 15 × 54 | 43.317 | Macchia completa: usarla come quinta lontana o scomporla in alberi/cespugli. |
| `clover-planter` | Fioriera di trifoglio | 3dhdscan | CC-BY-4.0 | 0,6 × 0,5 × 0,6 | 8.160 | Arredo di piazza, non vegetazione di campo. |
| `cerchi-di-pioggia` | Cerchi di pioggia | VRA | CC-BY-4.0 | 963 × 0,5 × 962 | 84 | VFX: va nel sistema meteo, non nel world kit statico. |
| `neve-che-cade` | Neve che cade | Elin | CC-BY-4.0 | 15,7 × 3 × 15,2 | 1.800 | VFX: stesso discorso; particelle, non mesh da piazzare. |
| `lampione-da-sentiero` | Lampione da sentiero | Skipperino | CC-BY-4.0 | 2,8 × 4 × 2,8 | 840 | Leggero: buono per sentieri e piazze, ma il ruolo `streetlight` oggi usa i quattro modelli del pack stradale. |

### P3 — casi speciali, da trattare con attenzione

| Slug | Nome | Autore | Licenza | Ingombro (m) | Tri | Nota |
| --- | --- | --- | --- | --- | --- | --- |
| `palo-elettrico` | Palo elettrico | Cau Hi | CC-BY-4.0 | 98,6 × 9 × 867,4 | 7.861 | Ingombro non credibile: probabilmente contiene più pali/linee; separare i nodi. |
| `chiesa-venezia` | Chiesa (Venezia) | rmass | CC-BY-4.0 | 16,1 × 18 × 15,7 | 28.798 | Landmark fuori contesto molisano: usarla solo se serve un edificio religioso generico. |
| `passerella` | Passerella | OrbArts | CC-BY-SA-4.0 | 47,1 × 1 × 47,1 | 11.517 | **Share-alike**: l'eventuale opera derivata resta CC BY-SA 4.0. |
| `strada-innevata` | Strada innevata | Vlad | CC-BY-SA-4.0 | 18,7 × 4 × 29,1 | 576.662 | **Share-alike** e 577k tri: solo evento neve, con LOD dedicato. |
| `via-s-gemini` | Via S. Gemini | Andrea Spognetta (Spogna) | CC-BY-NC-4.0 | 42,4 × 8 × 13,2 | 32.329 | **Non commerciale**: esclusa dalla build commerciale e dai preset di default. |
| `vecchio-quartiere` | Vecchio quartiere | — | CC-BY-4.0 | — | 964 | Pack di arredo urbano: ruolo `spare`, da smistare in `house`/`sign`/`streetlight` se serve. |
| `svincolo-autostradale` | Svincolo autostradale | — | CC-BY-4.0 | — | 9.097 | Ponte/svincolo: stesso discorso di `bridge`, richiede un piazzamento dedicato. |
| `infrastruttura-urbana` | Infrastruttura urbana | PropShop | CC-BY-4.0 | — | 105.769 | Mappa urbana completa: troppo grande per il mondo attuale, utile come riferimento o quinta. |
| `bridge-modular` | Ponte modulare | — | CC-BY-4.0 | 18 × 1,1 × 14,4 | 36.633 | Ruolo `bridge` già pronto; manca il collegamento ai ponti OSM. |
| `bridge-highway` | Ponte autostradale | — | CC-BY-NC-4.0 | 20 × 20 × 10 | 592 | **Non commerciale**; stesso ruolo `bridge`, escluso da `VITE_COMMERCIAL_BUILD=1`. |

## Ordine di lavoro consigliato

1. Collegare il ruolo `bridge` ai ponti OSM (`road.bridge`): oggi i ponti sono
   geometria procedurale, i due GLB sono pronti ma restano riserva.
2. Riprocessare i tre terreni (`terreno`, `terreno-di-strada`, `terreno-fng`) e
   decidere se il ruolo `ground` è un decal o una mesh; nel frattempo la fisica
   e la grana del terreno coprono già il bisogno.
3. Estrarre da `tracce-nel-fango` una texture di decal (niente 33k tri per
   impronta) e collegarla al sistema delle tracce di gomma.
4. Spostare `cerchi-di-pioggia` e `neve-che-cade` nel sistema meteo, non nel
   world kit.
5. Tenere `via-s-gemini` e `bridge-highway` fuori dalla build commerciale;
   `passerella` e `strada-innevata` solo dopo una verifica legale della licenza
   share-alike.

## Verifica

- `npm run worldkit -- --check` controlla manifest, file e crediti.
- `tests/worldkit.test.ts` impone che ogni ruolo nuovo abbia almeno un modello e
  che il totale resti sotto i 90 MiB.
- `tests/quality.test.ts` impone che `roadside` cresca dal minimo all'ultra e
  valga 0 su `minimal`.
- Banco prova: `node scripts/bench.mjs --quality medium --url http://127.0.0.1:5173`.
