import { logger } from '@/config/logger';

type DemoSeeder = { name: string; order: number; run: (clinicId: string) => Promise<void> };
const demoSeeders: DemoSeeder[] = [];

/** Modules add demo data (chairs, patients, appointments, invoices…) for the demo clinic. */
export function registerDemoSeeder(s: DemoSeeder): void {
  if (!demoSeeders.some((x) => x.name === s.name)) demoSeeders.push(s);
}

export async function seedDemoData(clinicId: string): Promise<void> {
  for (const s of [...demoSeeders].sort((a, b) => a.order - b.order)) {
    logger.info({ seeder: s.name }, 'demo data');
    await s.run(clinicId);
  }
}
