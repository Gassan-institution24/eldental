/**
 * Starter global procedure catalog (07 §12). Codes are "CDT-like" internal codes; names are
 * i18n keys `seed.procedure.<code>` (our own wording, not the official CDT descriptors).
 */
export type ChartEffect = { setStatus?: 'missing' | 'implant' | 'present'; addCondition?: string; removeConditions?: string[] };
export type CatalogEntry = {
  code: string;
  category: ProcedureCategory;
  toothRequired?: boolean;
  surfacesRequired?: boolean;
  minutes: number;
  /** Suggested price in JOD fils (clinics set their own). */
  price: number;
  chartEffect?: ChartEffect;
  recall?: { type: 'cleaning' | 'checkup' | 'ortho_adjustment'; months: number };
  labRequired?: boolean;
};

export const PROCEDURE_CATEGORIES = [
  'diagnostic',
  'preventive',
  'restorative',
  'endodontics',
  'periodontics',
  'prosthodontics',
  'oral_surgery',
  'orthodontics',
  'implants',
  'cosmetic',
  'other',
] as const;
export type ProcedureCategory = (typeof PROCEDURE_CATEGORIES)[number];

const T = true;
const fill = (surfaces = true): Partial<CatalogEntry> => ({ toothRequired: T, surfacesRequired: surfaces, chartEffect: { addCondition: 'filling', removeConditions: ['caries'] } });

export const PROCEDURE_CATALOG: CatalogEntry[] = [
  // diagnostic
  { code: 'D0120', category: 'diagnostic', minutes: 20, price: 10000, recall: { type: 'checkup', months: 6 } },
  { code: 'D0140', category: 'diagnostic', minutes: 15, price: 10000 },
  { code: 'D0150', category: 'diagnostic', minutes: 30, price: 15000 },
  { code: 'D0180', category: 'diagnostic', minutes: 40, price: 25000 },
  { code: 'D0210', category: 'diagnostic', minutes: 20, price: 40000 },
  { code: 'D0220', category: 'diagnostic', minutes: 10, price: 5000, toothRequired: T },
  { code: 'D0274', category: 'diagnostic', minutes: 10, price: 10000 },
  { code: 'D0330', category: 'diagnostic', minutes: 10, price: 15000 },
  { code: 'D0367', category: 'diagnostic', minutes: 20, price: 60000 },
  { code: 'D0470', category: 'diagnostic', minutes: 20, price: 20000 },
  // preventive
  { code: 'D1110', category: 'preventive', minutes: 45, price: 30000, recall: { type: 'cleaning', months: 6 } },
  { code: 'D1120', category: 'preventive', minutes: 30, price: 20000, recall: { type: 'cleaning', months: 6 } },
  { code: 'D1206', category: 'preventive', minutes: 15, price: 15000 },
  { code: 'D1208', category: 'preventive', minutes: 15, price: 12000 },
  { code: 'D1330', category: 'preventive', minutes: 15, price: 5000 },
  { code: 'D1351', category: 'preventive', minutes: 15, price: 15000, toothRequired: T, chartEffect: { addCondition: 'sealant' } },
  { code: 'D1510', category: 'preventive', minutes: 30, price: 50000, toothRequired: T, labRequired: T },
  { code: 'D9910', category: 'preventive', minutes: 15, price: 10000 },
  // restorative
  { code: 'D2140', category: 'restorative', minutes: 30, price: 25000, ...fill() },
  { code: 'D2150', category: 'restorative', minutes: 40, price: 30000, ...fill() },
  { code: 'D2160', category: 'restorative', minutes: 45, price: 35000, ...fill() },
  { code: 'D2330', category: 'restorative', minutes: 30, price: 30000, ...fill() },
  { code: 'D2331', category: 'restorative', minutes: 35, price: 35000, ...fill() },
  { code: 'D2332', category: 'restorative', minutes: 40, price: 40000, ...fill() },
  { code: 'D2335', category: 'restorative', minutes: 45, price: 45000, ...fill() },
  { code: 'D2391', category: 'restorative', minutes: 35, price: 35000, ...fill() },
  { code: 'D2392', category: 'restorative', minutes: 40, price: 40000, ...fill() },
  { code: 'D2393', category: 'restorative', minutes: 45, price: 45000, ...fill() },
  { code: 'D2394', category: 'restorative', minutes: 50, price: 50000, ...fill() },
  { code: 'D2510', category: 'restorative', minutes: 60, price: 120000, toothRequired: T, surfacesRequired: T, labRequired: T, chartEffect: { addCondition: 'inlay' } },
  { code: 'D2740', category: 'restorative', minutes: 60, price: 200000, toothRequired: T, labRequired: T, chartEffect: { addCondition: 'crown' } },
  { code: 'D2750', category: 'restorative', minutes: 60, price: 150000, toothRequired: T, labRequired: T, chartEffect: { addCondition: 'crown' } },
  { code: 'D2790', category: 'restorative', minutes: 60, price: 250000, toothRequired: T, labRequired: T, chartEffect: { addCondition: 'crown' } },
  { code: 'D2920', category: 'restorative', minutes: 20, price: 15000, toothRequired: T },
  { code: 'D2930', category: 'restorative', minutes: 30, price: 40000, toothRequired: T, chartEffect: { addCondition: 'crown' } },
  { code: 'D2950', category: 'restorative', minutes: 30, price: 40000, toothRequired: T },
  { code: 'D2954', category: 'restorative', minutes: 40, price: 60000, toothRequired: T, chartEffect: { addCondition: 'post' } },
  // endodontics
  { code: 'D3110', category: 'endodontics', minutes: 20, price: 20000, toothRequired: T },
  { code: 'D3220', category: 'endodontics', minutes: 40, price: 50000, toothRequired: T },
  { code: 'D3310', category: 'endodontics', minutes: 60, price: 120000, toothRequired: T, chartEffect: { addCondition: 'rct' } },
  { code: 'D3320', category: 'endodontics', minutes: 75, price: 150000, toothRequired: T, chartEffect: { addCondition: 'rct' } },
  { code: 'D3330', category: 'endodontics', minutes: 90, price: 180000, toothRequired: T, chartEffect: { addCondition: 'rct' } },
  { code: 'D3346', category: 'endodontics', minutes: 90, price: 200000, toothRequired: T, chartEffect: { addCondition: 'rct' } },
  { code: 'D3410', category: 'endodontics', minutes: 60, price: 150000, toothRequired: T },
  // periodontics
  { code: 'D4210', category: 'periodontics', minutes: 60, price: 150000 },
  { code: 'D4249', category: 'periodontics', minutes: 60, price: 120000, toothRequired: T },
  { code: 'D4341', category: 'periodontics', minutes: 45, price: 40000 },
  { code: 'D4342', category: 'periodontics', minutes: 30, price: 25000 },
  { code: 'D4355', category: 'periodontics', minutes: 45, price: 40000 },
  { code: 'D4910', category: 'periodontics', minutes: 45, price: 35000, recall: { type: 'cleaning', months: 3 } },
  // prosthodontics
  { code: 'D5110', category: 'prosthodontics', minutes: 60, price: 400000, labRequired: T },
  { code: 'D5120', category: 'prosthodontics', minutes: 60, price: 400000, labRequired: T },
  { code: 'D5213', category: 'prosthodontics', minutes: 60, price: 450000, labRequired: T },
  { code: 'D5214', category: 'prosthodontics', minutes: 60, price: 450000, labRequired: T },
  { code: 'D5410', category: 'prosthodontics', minutes: 20, price: 20000 },
  { code: 'D5750', category: 'prosthodontics', minutes: 45, price: 80000, labRequired: T },
  { code: 'D6240', category: 'prosthodontics', minutes: 60, price: 200000, toothRequired: T, labRequired: T, chartEffect: { addCondition: 'bridge_pontic' } },
  { code: 'D6750', category: 'prosthodontics', minutes: 60, price: 200000, toothRequired: T, labRequired: T, chartEffect: { addCondition: 'bridge_abutment' } },
  { code: 'D6930', category: 'prosthodontics', minutes: 30, price: 30000, toothRequired: T },
  // implants
  { code: 'D6010', category: 'implants', minutes: 90, price: 600000, toothRequired: T, chartEffect: { setStatus: 'implant' } },
  { code: 'D6056', category: 'implants', minutes: 30, price: 150000, toothRequired: T, labRequired: T },
  { code: 'D6065', category: 'implants', minutes: 60, price: 350000, toothRequired: T, labRequired: T, chartEffect: { addCondition: 'crown' } },
  { code: 'D6104', category: 'implants', minutes: 60, price: 200000, toothRequired: T },
  { code: 'D7951', category: 'implants', minutes: 90, price: 400000 },
  // oral surgery
  { code: 'D7140', category: 'oral_surgery', minutes: 30, price: 30000, toothRequired: T, chartEffect: { setStatus: 'missing' } },
  { code: 'D7210', category: 'oral_surgery', minutes: 45, price: 60000, toothRequired: T, chartEffect: { setStatus: 'missing' } },
  { code: 'D7220', category: 'oral_surgery', minutes: 60, price: 100000, toothRequired: T, chartEffect: { setStatus: 'missing' } },
  { code: 'D7240', category: 'oral_surgery', minutes: 75, price: 150000, toothRequired: T, chartEffect: { setStatus: 'missing' } },
  { code: 'D7250', category: 'oral_surgery', minutes: 45, price: 70000, toothRequired: T, chartEffect: { setStatus: 'missing' } },
  { code: 'D7310', category: 'oral_surgery', minutes: 45, price: 60000 },
  { code: 'D7510', category: 'oral_surgery', minutes: 30, price: 30000 },
  { code: 'D7960', category: 'oral_surgery', minutes: 30, price: 80000 },
  // orthodontics
  { code: 'D8010', category: 'orthodontics', minutes: 60, price: 600000, recall: { type: 'ortho_adjustment', months: 1 } },
  { code: 'D8080', category: 'orthodontics', minutes: 60, price: 1500000, recall: { type: 'ortho_adjustment', months: 1 } },
  { code: 'D8090', category: 'orthodontics', minutes: 60, price: 1800000, recall: { type: 'ortho_adjustment', months: 1 } },
  { code: 'D8670', category: 'orthodontics', minutes: 30, price: 30000, recall: { type: 'ortho_adjustment', months: 1 } },
  { code: 'D8680', category: 'orthodontics', minutes: 45, price: 100000, labRequired: T },
  { code: 'D8090A', category: 'orthodontics', minutes: 45, price: 2500000, labRequired: T },
  // cosmetic
  { code: 'D9972', category: 'cosmetic', minutes: 60, price: 150000 },
  { code: 'D9975', category: 'cosmetic', minutes: 30, price: 120000, labRequired: T },
  { code: 'D2962', category: 'cosmetic', minutes: 60, price: 250000, toothRequired: T, labRequired: T, chartEffect: { addCondition: 'veneer' } },
  { code: 'D9970', category: 'cosmetic', minutes: 30, price: 40000, toothRequired: T },
  // other
  { code: 'D9110', category: 'other', minutes: 20, price: 15000 },
  { code: 'D9230', category: 'other', minutes: 15, price: 15000 },
  { code: 'D9944', category: 'other', minutes: 30, price: 80000, labRequired: T },
  { code: 'D9999', category: 'other', minutes: 30, price: 0 },
];

/** Tooth conditions shown on the chart (07 §2, 03 §6). */
export const TOOTH_CONDITIONS: { code: string; color: string; appliesTo: 'tooth' | 'surface' }[] = [
  { code: 'caries', color: '#EF4444', appliesTo: 'surface' },
  { code: 'filling', color: '#3B82F6', appliesTo: 'surface' },
  { code: 'inlay', color: '#6366F1', appliesTo: 'surface' },
  { code: 'sealant', color: '#14B8A6', appliesTo: 'surface' },
  { code: 'fracture', color: '#F97316', appliesTo: 'surface' },
  { code: 'crown', color: '#A855F7', appliesTo: 'tooth' },
  { code: 'rct', color: '#10B981', appliesTo: 'tooth' },
  { code: 'post', color: '#059669', appliesTo: 'tooth' },
  { code: 'missing', color: '#94A3B8', appliesTo: 'tooth' },
  { code: 'implant', color: '#0EA5E9', appliesTo: 'tooth' },
  { code: 'bridge_pontic', color: '#C084FC', appliesTo: 'tooth' },
  { code: 'bridge_abutment', color: '#9333EA', appliesTo: 'tooth' },
  { code: 'veneer', color: '#EC4899', appliesTo: 'tooth' },
  { code: 'impacted', color: '#78716C', appliesTo: 'tooth' },
  { code: 'mobility', color: '#EAB308', appliesTo: 'tooth' },
  { code: 'abscess', color: '#DC2626', appliesTo: 'tooth' },
];

/** Common dental medicines (prescription presets, 07 §7). Names are generic drug names. */
export const MEDICINES: { name: string; form: string; dose: string; frequency: string; days: number; group: 'analgesic' | 'antibiotic' | 'antiseptic' | 'anti_inflammatory' | 'other' }[] = [
  { name: 'Amoxicillin 500 mg', form: 'capsule', dose: '1 capsule', frequency: 'every 8 hours', days: 7, group: 'antibiotic' },
  { name: 'Amoxicillin/Clavulanate 1 g', form: 'tablet', dose: '1 tablet', frequency: 'every 12 hours', days: 7, group: 'antibiotic' },
  { name: 'Clindamycin 300 mg', form: 'capsule', dose: '1 capsule', frequency: 'every 8 hours', days: 7, group: 'antibiotic' },
  { name: 'Azithromycin 500 mg', form: 'tablet', dose: '1 tablet', frequency: 'once daily', days: 3, group: 'antibiotic' },
  { name: 'Metronidazole 500 mg', form: 'tablet', dose: '1 tablet', frequency: 'every 8 hours', days: 7, group: 'antibiotic' },
  { name: 'Ibuprofen 400 mg', form: 'tablet', dose: '1 tablet', frequency: 'every 8 hours after food', days: 5, group: 'anti_inflammatory' },
  { name: 'Ibuprofen 600 mg', form: 'tablet', dose: '1 tablet', frequency: 'every 8 hours after food', days: 5, group: 'anti_inflammatory' },
  { name: 'Diclofenac 50 mg', form: 'tablet', dose: '1 tablet', frequency: 'every 12 hours after food', days: 5, group: 'anti_inflammatory' },
  { name: 'Paracetamol 500 mg', form: 'tablet', dose: '2 tablets', frequency: 'every 6 hours as needed', days: 5, group: 'analgesic' },
  { name: 'Paracetamol 1 g', form: 'tablet', dose: '1 tablet', frequency: 'every 8 hours as needed', days: 3, group: 'analgesic' },
  { name: 'Chlorhexidine 0.12% mouthwash', form: 'mouthwash', dose: '15 ml', frequency: 'rinse twice daily', days: 10, group: 'antiseptic' },
  { name: 'Benzydamine mouthwash', form: 'mouthwash', dose: '15 ml', frequency: 'rinse three times daily', days: 7, group: 'antiseptic' },
  { name: 'Nystatin oral suspension', form: 'suspension', dose: '1 ml', frequency: 'four times daily', days: 7, group: 'other' },
  { name: 'Fluoride gel 1.1%', form: 'gel', dose: 'pea-sized amount', frequency: 'once daily at bedtime', days: 30, group: 'other' },
];
