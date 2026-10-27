/**
 * Crediti dei modelli 3D importati.
 *
 * I metadati sono quelli dichiarati dall'autore dentro il GLB (asset.extras)
 * oppure, per i tre file che non li incorporano, quelli della pagina Sketchfab
 * indicata. Restano separati dal catalogo delle prestazioni: un modello puo'
 * essere sostituito o rimosso senza perdere la traccia della licenza.
 *
 * `listedInProvidedCredits` distingue i 25 modelli presenti nella lista fornita
 * dal proprietario dai 5 file aggiunti nello stesso archivio ma fuori elenco.
 */

export interface VehicleCredit {
  /** stesso id di `VehicleSpec.id` */
  id: string;
  title: string;
  author: string;
  authorUrl: string;
  source: string;
  /** sigla esatta dichiarata dall'autore (es. CC-BY-NC-SA-4.0) */
  license: string;
  licenseUrl: string;
  /** false = non era nella lista di 25 voci fornita dal proprietario */
  listedInProvidedCredits: boolean;
  /** true solo per licenze che consentono la ridistribuzione del file */
  redistributable: boolean;
}

const CC = {
  by: { license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', redistributable: true },
  byNc: { license: 'CC-BY-NC-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/', redistributable: true },
  byNcSa: {
    license: 'CC-BY-NC-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    redistributable: true,
  },
} as const;

const STANDARD = {
  license: 'SKETCHFAB Standard',
  licenseUrl: 'https://sketchfab.com/licenses',
  redistributable: false,
} as const;

function credit(
  id: string,
  title: string,
  author: string,
  authorUrl: string,
  source: string,
  terms: typeof CC.by | typeof CC.byNc | typeof CC.byNcSa | typeof STANDARD,
  listedInProvidedCredits = true,
): VehicleCredit {
  return { id, title, author, authorUrl, source, ...terms, listedInProvidedCredits };
}

export const VEHICLE_CREDITS: readonly VehicleCredit[] = [
  credit(
    'audi-r8-2010',
    '2010 Audi R8 5.2 FSI Quattro',
    'OUTPISTON',
    'https://sketchfab.com/outpiston',
    'https://sketchfab.com/3d-models/2010-audi-r8-52-fsi-quattro-fa645f1a40ae44cf980833d226747a20',
    CC.byNcSa,
  ),
  credit(
    'fiat-punto-2011',
    '2011 Fiat Punto',
    'tonielpro520',
    'https://sketchfab.com/tonielpro520',
    'https://sketchfab.com/3d-models/2011-fiat-punto-888037316bf8471c96014aeec9975f1d',
    CC.by,
  ),
  credit(
    'bmw-m4-competition-2021',
    '2021 BMW M4 Competition',
    'Ricy',
    'https://sketchfab.com/ngon_3d',
    'https://sketchfab.com/3d-models/2021-bmw-m4-competition-d3f07b471d9f4a2c9a2acf79d88a3645',
    CC.byNc,
  ),
  credit(
    'yamaha-mt09-sp-2025',
    '2025 Yamaha MT-09 SP V4',
    'VTX',
    'https://sketchfab.com/VTX_car',
    'https://sketchfab.com/3d-models/2025-yamaha-mt-09-sp-v4-cb5878baf5974167806eb8524d57f0b0',
    CC.byNcSa,
  ),
  credit(
    'aston-martin-db11',
    'Aston Martin DB11',
    'Sohan3D',
    'https://sketchfab.com/Sohan3D',
    'https://sketchfab.com/3d-models/aston-martin-db11-b100f0109858476987f8185122e1b36a',
    CC.by,
    false,
  ),
  credit(
    'audi-novulari',
    'Audi Novulari',
    'hartwelkisaka',
    'https://sketchfab.com/hartwelkisaka',
    'https://sketchfab.com/3d-models/audi-novulari-e957da9a57d5453493e8c44a0cb62d93',
    CC.by,
  ),
  credit(
    'audi-r8-2023',
    'Audi R8 Coupe Performance quattro 2023',
    'bluspycrab',
    'https://sketchfab.com/bluspycrab',
    'https://sketchfab.com/3d-models/audi-r8-coupe-performance-quattro-2023-9f25cc6b911a4269ae84d64827d981be',
    CC.by,
  ),
  credit(
    'bmw-1930s-saloon',
    'BMW inspired 1930s Saloon car',
    'Libau Media',
    'https://sketchfab.com/robinmikart',
    'https://sketchfab.com/3d-models/bmw-inspired-1930s-saloon-car-879bf49adce84d8293905aef30a5383f',
    CC.by,
  ),
  credit(
    'bmw-m3-sedan',
    'BMW M3 Sedan topaz blue car',
    'stefrolland',
    'https://sketchfab.com/stefrolland',
    'https://sketchfab.com/3d-models/bmw-m3-sedan-topaz-blue-car-981462d1149b48628fc3d8d993a3f959',
    CC.by,
  ),
  credit(
    'cupra-terramar',
    'Cupra_Terramar_Hero_Purple_GLB',
    'MattDoesBlender',
    'https://sketchfab.com/MattDoesBlender',
    'https://sketchfab.com/3d-models/cupra-terramar-hero-purple-glb-ede46b2945a0400cafb9d49be9d22390',
    CC.byNcSa,
  ),
  credit(
    'detomaso-p900',
    'DeTomaso P900',
    'bluspycrab',
    'https://sketchfab.com/bluspycrab',
    'https://sketchfab.com/3d-models/detomaso-p900-d2ac37797c654da18ec12c2b2d188b8d',
    CC.by,
  ),
  credit(
    'ferrari-f1-2019',
    'Ferrari F1 2019',
    'valvetin',
    'https://sketchfab.com/valvetin',
    'https://sketchfab.com/3d-models/ferrari-f1-2019-1b050bffe4e749b586b4782ee7ff4fd0',
    CC.by,
  ),
  credit(
    'ferrari-laferrari',
    'Ferrari Laferrari | www.vecarz.com',
    'vecarz',
    'https://sketchfab.com/heynic',
    'https://sketchfab.com/3d-models/ferrari-laferrari-wwwvecarzcom-979f7085012e4d6399f38de3f9c39012',
    CC.byNcSa,
  ),
  credit(
    'fiat-500',
    'Fiat 500',
    'Francesco Coldesina',
    'https://sketchfab.com/topfrank2013',
    'https://sketchfab.com/3d-models/fiat-500-4606659ff31142e3b8080f995514452f',
    CC.by,
  ),
  credit(
    'fiat-500-1970',
    'Fiat 500 - 1970 Model',
    'Parsa Farvadian',
    'https://sketchfab.com/parsafarvadian',
    'https://sketchfab.com/3d-models/fiat-500-1970-model-213cd126fcd744809fb7996eb88366f5',
    CC.by,
  ),
  credit(
    'fiat-500-abarth',
    'Fiat 500 Abarth',
    'attix84work',
    'https://sketchfab.com/attix84work',
    'https://sketchfab.com/3d-models/fiat-500-abarth-c14dac5368f94dc886dbdd78e0cd9644',
    CC.by,
  ),
  credit(
    'fiat-multipla-1998',
    'Fiat Multipla 1998 3D Model',
    'Betier Models',
    'https://sketchfab.com/betier',
    'https://sketchfab.com/3d-models/fiat-multipla-1998-3d-model-53cb07fa6a264cca811952c7ff3f3b38',
    CC.by,
  ),
  credit(
    'fiat-panda-4x4',
    'FIAT Panda 4x4',
    'Duhyeen',
    'https://sketchfab.com/veedduh',
    'https://sketchfab.com/3d-models/fiat-panda-4x4-5f4f1ce29e884dd19c4eea5fb13606ae',
    STANDARD,
    false,
  ),
  credit(
    'fiat-uno-1994',
    'Fiat Uno 1994',
    'ARDmation',
    'https://sketchfab.com/ardmation',
    'https://sketchfab.com/3d-models/fiat-uno-1994-e81d01b9513947ac9e223fff1e669eff',
    CC.by,
  ),
  credit(
    'fiat-punto-gt-1995',
    '(FREE) 1995 Fiat Punto GT',
    'Karol Miklas',
    'https://sketchfab.com/karolmiklas',
    'https://sketchfab.com/3d-models/free-1995-fiat-punto-gt-48db6facb4b64e99b60f36b8c01185e1',
    CC.by,
  ),
  credit(
    'honda-civic-rs',
    'Honda Civic RS',
    'geyges',
    'https://sketchfab.com/geyges',
    'https://sketchfab.com/3d-models/honda-civic-rs-24cdb4612a394cf4827326dbad0126a5',
    STANDARD,
    false,
  ),
  credit(
    'lamborghini-revuelto',
    'LAMBORGINI REVOLTO',
    'GRID',
    'https://sketchfab.com/vinayaka9585',
    'https://sketchfab.com/3d-models/lamborgini-revolto-7e35133684e94aef97d1f2f8693acc67',
    CC.by,
  ),
  credit(
    'land-rover-defender',
    'Land Rover Defender',
    'zhe_kan',
    'https://sketchfab.com/zhe_kan',
    'https://sketchfab.com/3d-models/land-rover-defender-7c482fc5dffa419888482d104e1621d2',
    CC.by,
  ),
  credit(
    'mg-cyberster-2025',
    '2025 MG Cyberster (GLB)(mgmotor.com.mx)',
    'MattDoesBlender',
    'https://sketchfab.com/MattDoesBlender',
    'https://sketchfab.com/3d-models/2025-mg-cyberster-glbmgmotorcommx-194c998698594d7e825c9f5dedcdbef3',
    CC.byNcSa,
  ),
  credit(
    'porsche-911-mistery',
    'Mistery Porsche',
    'bluspycrab',
    'https://sketchfab.com/bluspycrab',
    'https://sketchfab.com/3d-models/mistery-porsche-17138fb7d2614e939aa739dfb435ab6e',
    CC.by,
  ),
  credit(
    'seat-leon-cupra-race',
    'Seat Leon Cupra Race Car',
    'Nieve5677',
    'https://sketchfab.com/niev',
    'https://sketchfab.com/3d-models/seat-leon-cupra-race-car-e7e88cf7844547ec95aea01eb7348d5a',
    CC.by,
  ),
  credit(
    'tesla-cybertruck',
    'Tesla-Cybertruck',
    'ghafurian.mahdi',
    'https://sketchfab.com/ghafurian.mahdi',
    'https://sketchfab.com/3d-models/tesla-cybertruck-65b073651eb84cc0998afb381a32dd2b',
    CC.by,
  ),
  credit(
    'vespa-scooter',
    'Vespa Scooter',
    'The Salty Popeye',
    'https://sketchfab.com/TheSaltyPopeye',
    'https://sketchfab.com/3d-models/vespa-scooter-cbbceaccc1d24bbb8c7c060542ac20ad',
    CC.by,
  ),
  credit(
    'volkswagen-crafter',
    'Volkswagen Crafter',
    'geyges',
    'https://sketchfab.com/geyges',
    'https://sketchfab.com/3d-models/volkswagen-crafter-647fb3d619c645a4b8e62d80db7cab98',
    STANDARD,
    false,
  ),
  credit(
    'volkswagen-golf-gti-2025',
    'Volkswagen Golf GTI (2025)',
    'geyges',
    'https://sketchfab.com/geyges',
    'https://sketchfab.com/3d-models/volkswagen-golf-gti-2025-84fe6c2b9feb4c8a854d16f3daf33eab',
    STANDARD,
    false,
  ),
];

const BY_ID = new Map(VEHICLE_CREDITS.map((entry) => [entry.id, entry]));

export function creditFor(id: string): VehicleCredit | null {
  return BY_ID.get(id) ?? null;
}
