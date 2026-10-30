# ElDental — Module: Scheduling & Appointments

> Replaces Hakeemna's `appointment_config` + pre-generated empty appointment documents + work-group calendars.
> In ElDental, **an appointment is only created when someone books.** Free slots are **computed on demand**.

---

## 1. Concepts

| Concept | Model | Purpose |
|---|---|---|
| Clinic hours | `clinics.workingHours` | Outer bound. Nothing is bookable outside it. |
| Dentist weekly schedule | `dentistSchedules` | When each dentist works, in which chair, and which appointment types are allowed |
| Exceptions | `scheduleExceptions` | Vacation, sick leave (auto from HR), public holidays, extra hours, chair maintenance |
| Chairs | `chairs` | Physical resource; also cannot be double-booked |
| Appointment types | `appointmentTypes` | Default duration, colour, online-bookable flag, buffer |
| Appointment | `appointments` | A booked visit: patient + dentist (+ chair) + time |
| Slot locks | `slotLocks` | Concurrency guard against double booking |

**Dentist = the bookable resource**, which removes the need for work groups. Assistants are optional extra participants (`assistantIds`).

---

## 2. Availability Algorithm

`GET /availability?dentistId=&appointmentTypeId=&from=&to=&chairId?=&durationMin?=`

1. `duration = durationMin ?? appointmentType.defaultDurationMin`; `step = schedule.slotGranularityMin` (default 15).
2. For each day in `[from, to]` (clinic timezone, max 42 days):
   1. Clinic closed that day (working hours / clinic-wide holiday exception) → skip.
   2. Take the dentist's effective schedule blocks for that weekday. Keep only blocks that allow the appointment type (empty list = all).
   3. Add `extra_hours` exceptions; subtract `time_off` / `holiday` exceptions.
   4. Subtract existing appointments of the dentist with status ∉ {`cancelled`, `no_show`}, including `bufferAfterMin`.
   5. If a chair is required (block chair or requested chair), subtract that chair's appointments and `chair_maintenance` exceptions.
   6. Walk the remaining intervals in `step` increments and emit `{ start, end, chairId }` where `[start, start+duration]` fits.
   7. Online requests also need the block's `onlineBookable`, `appointmentType.allowOnline`, `staff.bookableOnline`, a start time ≥ now + `clinic.settings.minOnlineLeadHours`, and a date within `maxOnlineDaysAhead`.
3. Return slots grouped by day.
   - "Any dentist" mode (no `dentistId`): union across bookable dentists, each slot labelled with its dentist.

Implementation: a pure function `computeSlots(input): Slot[]` in `scheduling/availability.engine.ts`, with **thorough unit tests**. Cover DST-free Asia/Amman, but use the clinic TZ generically. The service only gathers data and calls the engine.

---

## 3. Booking (no double booking, ever)

`POST /appointments` body: `{ patientId, dentistId, chairId?, appointmentTypeId, start, durationMin?, plannedItems?, notes, source }`

Inside `withTransaction`:
1. Validate:
   - the patient is active;
   - the dentist is active and `staffType ∈ {dentist, hygienist}`;
   - the chair is active;
   - `start` is aligned to the granularity.
2. Re-run the availability check for that exact window. This **rejects times outside the schedule** unless the caller has `scheduling.appointment.book` scope `all` and passes `override: true` (emergency/overbook; audited).
3. Insert `slotLocks` rows for every 5-minute bucket of `[start, end)` for the dentist (and chair). The unique index means a concurrent booking fails with a duplicate key, which maps to `409 APPOINTMENT_SLOT_TAKEN`.
   - Overrides skip the locks only when `allowOverlap: true` is explicitly passed (double-booking a dentist for a quick check). The appointment is then flagged `overbooked: true`.
4. Create the appointment (`status: scheduled`, sequence `number`, `statusHistory`).
5. Commit, then emit `appointment.booked`. Subscribers:
   - notifications (WhatsApp/email confirmation to the patient);
   - schedule reminder jobs;
   - socket `appointment:changed` to `clinic:{id}`;
   - if `source = recall`, mark the recall `booked`;
   - if it comes from the waiting list, mark the entry `booked`.

**Reschedule** (`PATCH /appointments/:id` with a new `start`/`dentistId`/`chairId`) uses the same transaction: delete the old locks, insert the new ones, save, and append to `statusHistory`. Reminders are re-planned and the patient is notified.

---

## 4. State Machine

```
              ┌──────────── cancel ─────────────┐
              │                                  ▼
 scheduled ──confirm──► confirmed ──check-in──► arrived ──seat──► in_chair ──complete──► completed
     │  └──────────────check-in──────────────────▲                     │
     │                                                                 └─(cannot cancel once in_chair)
     ├── cancel ──► cancelled
     └── no-show ─► no_show   (allowed only after start + clinic.noShowGraceMinutes)
```

| From | Allowed to |
|---|---|
| scheduled | confirmed, arrived, cancelled, no_show |
| confirmed | arrived, cancelled, no_show |
| arrived | in_chair, cancelled (patient left; reason required) |
| in_chair | completed |
| completed | — (terminal; corrections are made via clinical/billing) |
| cancelled | — (terminal; "un-cancel" = book again, which keeps the history clean) |
| no_show | — (terminal) |

- Implemented as a transition table in `appointment.state.ts`. An invalid transition returns `409 INVALID_STATE_TRANSITION`.
- Each transition records `statusHistory`, sets timestamps (`checkInAt`, `seatedAt`, `completedAt`), emits `appointment.<status>` and broadcasts on the socket.
- `cancelled` / `no_show` release the `slotLocks`.
- A **late cancel** happens when it is less than `clinic.settings.cancellationWindowHours` before start. It sets `cancellation.lateCancel = true` (reported, and an optional fee).
- `completed`:
  - requires at least one performed procedure, **or** an explicit `noProcedures: true` with a reason;
  - emits `appointment.completed`, which makes billing create a **draft invoice** with lines from the visit's performed procedures (or add them to an open draft).
- Patients with ≥ N no-shows (setting) get a `medicalAlerts`-style badge "frequent no-show", and online booking can be blocked.

Display-only statuses (computed on the frontend from `status` + time):
- `late` = scheduled/confirmed and now > start + 10 min;
- `running_over` = in_chair and now > end.

This keeps Hakeemna's `presentationStatus` idea without storing it.

---

## 5. Reminders & Confirmations
- On booking, the `reminders` queue gets delayed jobs at `start − 24h` and `start − 2h` (configurable), with job id `appt:{id}:24h`. They are removed or re-added on reschedule or cancel.
- The 24h reminder message asks for a WhatsApp reply or a portal confirmation link. Confirming moves the appointment to `confirmed`.
- Every message goes through the `notifications` queue, respects patient `communicationPrefs`, and is logged in `messageLogs`.
- Channels: WhatsApp via Mazbot (credentials and templates entered by the superadmin in platform settings, never in `.env`), email, and in-app for portal users.
- A daily "tomorrow's list" email/notification goes to reception (replaces Hakeemna's `getBookedAppointments` 20:00 cron, now a BullMQ repeatable job per clinic TZ).

---

## 6. Waiting List
- An entry records patient, preferred dentist, type, days and time range, and priority.
- When an appointment is cancelled, the service finds matching waiting-list entries for the freed window and notifies reception (socket and notification). Reception presses **Offer** to send a WhatsApp offer with a booking link that expires in X hours.

## 7. Recalls
- On `procedure.completed` for categories with recall rules (e.g. prophylaxis gives a 6-month cleaning recall), create or update the patient's `recalls` entry with `dueDate`.
- A daily job marks recalls `due` 14 days ahead and sends recall messages (if consented).
- A recall list UI lets staff filter by due/overdue, contact, then book (`source: recall`).

## 8. Front-Desk "Today Board"
`GET /appointments/today-board` returns today's appointments grouped into columns:
- Upcoming
- Arrived (waiting, with wait time)
- In chair (by chair)
- Completed (unpaid / paid)
- No-show/cancelled

It updates live via `appointment:changed`. The board replaces Hakeemna's `entrance_management` with a simpler model.

## 9. Calendar UI Requirements
- A resource time grid with **columns = dentists** (toggle to chairs) for the day view, and columns = days for one dentist in the week view; click a free time to book. It is our own `TimeGrid` component, because FullCalendar's resource views are a paid premium plugin.
  - Drag/resize to reschedule; this calls PATCH, optimistically updates, and rolls back on 409.
  - Colour by appointment type, with a border colour for status.
  - Blocked time (exceptions) is shown as background events.
- The quick-book drawer has a patient typeahead and "create quick patient" (name + phone), then type → slot suggestions.
- A dentist with `own` scope sees only their own column by default.

## 10. Hakeemna Parity Checklist
| Hakeemna feature | ElDental equivalent |
|---|---|
| `appointment_config` + `config_frequency` pre-generation cron | `dentistSchedules` + on-demand availability (no cron) |
| `work_group` on appointment | `dentistId` (+ `chairId`, `assistantIds`) |
| `department` on appointment | removed |
| `/delay` bulk delay | `POST /appointments/bulk-shift { ids, minutes }` (re-checks locks, notifies patients) |
| `coming` confirmation | `confirmed` status + reminder confirmation link |
| `emergency` flag | `override`/`overbooked` with audit + `priority: emergency` |
| `bookWay` online/manually | `source` |
| entrance management | today board + status transitions |
| calendar events per work-group member | none needed; the calendar reads appointments directly |

## 11. Tests (must exist)
- Availability engine:
  - weekly blocks;
  - exceptions;
  - chair conflicts;
  - buffer;
  - granularity alignment;
  - online rules;
  - midnight edges;
  - "any dentist".
- Concurrency: 20 parallel bookings of the same slot result in exactly 1 success and 19 × 409.
- State machine: every allowed and disallowed transition.
- Reschedule releases the old locks; cancel releases locks; no-show only after the grace period.
- Scope: a dentist with `own` cannot book into another dentist's calendar.
