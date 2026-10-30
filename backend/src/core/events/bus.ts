import { logger } from '@/config/logger';
import { recordSystemError } from '../logging/systemErrors.service';

/**
 * In-process typed domain events, fired AFTER commit (02 §7). Subscribers must not throw into
 * the caller: failures are logged to systemErrors and the request still succeeds.
 */
export type DomainEvents = {
  'appointment.booked': { clinicId: string; appointmentId: string; actorUserId?: string };
  'appointment.rescheduled': { clinicId: string; appointmentId: string; previousStart: string; actorUserId?: string };
  'appointment.cancelled': { clinicId: string; appointmentId: string; actorUserId?: string };
  'appointment.statusChanged': { clinicId: string; appointmentId: string; from: string; to: string; actorUserId?: string };
  'appointment.completed': { clinicId: string; appointmentId: string; actorUserId?: string };
  'procedure.completed': { clinicId: string; procedureId: string; patientId: string; appointmentId?: string };
  'procedure.voided': { clinicId: string; procedureId: string };
  'invoice.issued': { clinicId: string; invoiceId: string };
  'payment.received': { clinicId: string; paymentId: string };
  'payment.refunded': { clinicId: string; paymentId: string };
  'leave.approved': { clinicId: string; leaveRequestId: string };
  'payroll.approved': { clinicId: string; payrollRunId: string };
  'plan.accepted': { clinicId: string; planId: string };
  'notification.created': { clinicId?: string; userId: string; notificationId: string };
};

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;
type AnyHandler = (payload: never) => Promise<void> | void;
const handlers = new Map<keyof DomainEvents, AnyHandler[]>();

export function on<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
  handlers.set(event, [...(handlers.get(event) ?? []), handler as AnyHandler]);
}

export async function emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): Promise<void> {
  for (const h of handlers.get(event) ?? []) {
    try {
      await (h as unknown as Handler<K>)(payload);
    } catch (err) {
      logger.error({ err, event }, 'event handler failed');
      void recordSystemError({ error: err, source: 'job', route: `event:${event}` });
    }
  }
}
