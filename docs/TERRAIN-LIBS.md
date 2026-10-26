# Librerie di terreno e vegetazione — licenze e verdetto

Verifica fatta il **26 ottobre 2026** leggendo i file `LICENSE` dei repository
(commit corrente al momento della verifica). Le quattro librerie indicate dal
proprietario sono **tutte MIT**, quindi compatibili con questo progetto
(codice modificabile e ridistribuibile, con la sola condizione di conservare
copyright e avviso di licenza). Non è stata aggiunta nessuna dipendenza: sotto
c'è il motivo, area per area.

| Progetto | Licenza | Cosa fa | Verdetto |
| --- | --- | --- | --- |
| [whidrubeld/three-map-terrain](https://github.com/whidrubeld/three-map-terrain) | MIT (© 2023 Vasilev Gennady) | Costruisce un mondo 3D da tile geografiche: DEM, immagini, edifici e strade OSM, ponti | **Da studiare, non da sostituire.** Fa lo stesso mestiere del nostro `Terrain`/`ImageryStreamer`/`roads.ts` ma con un altro modello di tile e un altro provider di immagini. Adottarne l'idea dei **ponti** e della **continuità del manto** agli incroci; non il pacchetto intero. |
| [giro3d](https://github.com/giro3d-org/Giro3D) (OSGeo) | MIT (© 2020-2026 Giro3D contributors) | Framework completo 2D/2.5D/3D geospaziale sopra three.js (mappe, tile, point cloud, 3D Tiles) | **Non adatto adesso.** È un motore di visualizzazione geospaziale: per usarlo bisognerebbe riscrivere terreno, streaming, camera e input attorno al suo `Instance`. Il nostro mondo è già un gioco, non un viewer GIS. Resta un riferimento per il caricamento di tile e 3D Tiles se un giorno servisse. |
| [IceCreamYou/THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain) | MIT (© 2010-2014 Isaac Sukin) | Terreno procedurale (rumori, erosione) e **scattering** di erba/mesh con LOD | **Idee sì, generatore no.** Il nostro terreno viene dal DEM reale e da OSM: un heightmap procedurale lo renderebbe finto. Utile invece la parte `createGrass`/`updateGrassLOD`: distanza di LOD per l'erba e jitter/raggruppamento, da portare nel nostro `GrassField` quando serve un raggio d'erba più ampio. |
| [cortiz2894/stylized-components](https://github.com/cortiz2894/stylized-components) | MIT (© 2026 Christian Ortiz) | Acqua e erba anime/cel-shaded in React Three Fiber + GLSL | **Non in linea con la direzione artistica.** Il progetto punta al fotorealismo molisano; lo stile anime e React Three Fiber introdurrebbero una seconda pipeline di rendering. Le tecniche GLSL (riccioli d'acqua, interazione con l'erba) restano un riferimento leggibile. |

## Cosa è stato adottato in questo passaggio

- **Erba**: tre quad incrociati per ciuffo invece di due, gradiente di colore
  per vertice (scuro al suolo, chiaro in punta), palette più spenta e
  mediterranea. L'effetto "foglia ritagliata" viene dall'assenza di
  auto-ombreggiatura, non dal numero di ciuffi.
- **Alberi**: otto card per chioma invece di sei, gradiente verticale sulle
  foglie, nucleo più piccolo e scuro. La chioma smette di leggersi come una
  palla verde con dei riquadri attorno.
- **Marciapiedi**: esistono solo dove ci sono case (`markTownSidewalks`), e la
  fisica legge la stessa maschera (`RoadIndex.surfaceOffset`). Le provinciali
  in campagna restano asfalto con il ciglio di ghiaia.
- **Incroci**: cordoli, marciapiedi e mezzeria si interrompono sulla strada
  che attraversa; l'attraversamento pedonale è arretrato di 5,2 m prima
  dell'incrocio invece di essere disegnato sopra.

## Cosa non è stato fatto (e perché)

- Nessun `npm install` di queste librerie: tre-map-terrain e Giro3D
  duplicherebbero lo streaming di tile e il sistema di coordinate; THREE.Terrain
  genererebbe un terreno che non è Palata.
- Le licenze delle **immagini** sono un altro capitolo: Esri World Imagery è
  solo demo non commerciale (vedi `HANDOFF.md` §6). Nessuna di queste librerie
  cambia quel vincolo.

## Se in futuro si integra qualcosa

1. Copiare **solo** il modulo utile (es. lo scattering con LOD), non il
   pacchetto, e conservare la nota di copyright MIT in `LICENSE`/`NOTICE`.
2. Metterlo dietro un preset grafico, con un interruttore per tornare al
   percorso attuale.
3. Misurare fps e memoria prima/dopo con `npm run bench`: il mondo attuale è
   già a 36 M triangoli sul preset `high`.
