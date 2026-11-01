import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Dental specialties on staff profiles (07 §13). */
useTestDb();
let c: TestClinic;
let owner: Session;

beforeEach(async () => {
  resetState();
  c = await makeClinic('spec');
  owner = await login(c.ownerEmail);
});

async function patch(id: string, body: Record<string, unknown>) {
  const version = (await api(owner).get(`/staff/${id}`)).body.data.version as number;
  return api(owner).patch(`/staff/${id}`).send({ version, ...body });
}

describe('dental specialties', () => {
  it('a dentist holds several specialties with exactly one primary', async () => {
    const id = c.staff.dentist!.staffId;
    const ok = await patch(id, { specialties: ['orthodontics', 'endodontics'], primarySpecialty: 'endodontics' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ specialties: ['orthodontics', 'endodontics'], primarySpecialty: 'endodontics' });

    expect((await patch(id, { primarySpecialty: 'periodontics' })).body.error.details.fields[0]).toMatchObject({ path: 'primarySpecialty', code: 'primary_not_in_list' });
    expect((await patch(id, { specialties: ['general'], primarySpecialty: null })).body.error.details.fields[0]).toMatchObject({ path: 'primarySpecialty', code: 'required' });
    const unknown = await patch(id, { specialties: ['cardiology'] });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details.fields[0].path).toMatch(/^specialties/);
    expect((await patch(id, { specialties: ['general', 'general'], primarySpecialty: 'general' })).status).toBe(422);
    // Clearing both is allowed.
    expect((await patch(id, { specialties: [], primarySpecialty: null })).body.data.specialties).toBeUndefined();
  });

  it('only dentists and hygienists can have specialties; changing the staff type clears them', async () => {
    const r = await patch(c.staff.reception!.staffId, { specialties: ['general'], primarySpecialty: 'general' });
    expect(r.body.error.details.fields[0]).toMatchObject({ path: 'specialties', code: 'not_allowed_for_staff_type' });
    const id = c.staff.dentist2!.staffId;
    await patch(id, { specialties: ['pediatric'], primarySpecialty: 'pediatric' });
    const moved = await patch(id, { staffType: 'assistant' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.specialties).toBeUndefined();
    expect(moved.body.data.primarySpecialty).toBeUndefined();
  });

  it('filters doctors by specialty and derives the clinic\'s specialties from its doctors', async () => {
    await patch(c.staff.dentist!.staffId, { specialties: ['orthodontics', 'general'], primarySpecialty: 'orthodontics' });
    await patch(c.staff.dentist2!.staffId, { specialties: ['general'], primarySpecialty: 'general' });
    const ortho = await api(owner).get('/staff?specialty=orthodontics');
    expect(ortho.body.data.map((s: { id: string }) => s.id)).toEqual([c.staff.dentist!.staffId]);
    expect((await api(owner).get('/staff?specialty=general')).body.data).toHaveLength(2);
    expect((await api(owner).get('/staff?specialty=nope')).status).toBe(422);
    const derived = await api(owner).get('/staff/specialties');
    expect(derived.body.data).toEqual([
      { code: 'general', doctors: 2 },
      { code: 'orthodontics', doctors: 1 },
    ]);
    const reception = await login(c.staff.reception!.email);
    expect((await api(reception).get('/staff/specialties')).status).toBe(200);
    const schedules = await api(owner).get('/dentist-schedules');
    expect(schedules.body.data.find((s: { staff: { id: string } }) => s.staff.id === c.staff.dentist!.staffId).staff).toMatchObject({ primarySpecialty: 'orthodontics' });
  });
});
