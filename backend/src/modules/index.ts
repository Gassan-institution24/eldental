import type { Router } from 'express';
import { authRouter } from './auth/auth.routes';
import { patientAuthRouter } from './auth/patientAuth';
import { portalRouter } from './portal/portal.routes';
import { contactRouter } from './public/contact';
import { clinicRouter } from './clinic/clinic.routes';
import { patientRouter } from './patients/patient.routes';
import { communicationRouter } from './patients/communication.routes';
import { accountingRouter } from './accounting/accounting.routes';
import { billingRouter } from './billing/billing.routes';
import { insightsRouter } from './insights/insights.routes';
import { notificationsRouter } from './notifications/notifications';
import { hrRouter } from './hr/hr.routes';
import { clinicalRouter } from './clinical/clinical.routes';
import { certificateRouter } from './clinical/certificate.routes';
import { instructionRouter } from './clinical/instruction.routes';
import { schedulingRouter } from './scheduling/scheduling.routes';
import { rolesRouter } from './roles/roles.routes';
import { staffRouter } from './staff/staff.routes';
import { telemetryRouter } from './telemetry/telemetry.routes';
import { adminRouter } from './admin/admin.routes';

/** Every feature module's router. Each router declares its own full paths (e.g. `/patients`). */
export const moduleRouters: Router[] = [authRouter, patientAuthRouter, portalRouter, telemetryRouter, staffRouter, rolesRouter, contactRouter, clinicRouter, patientRouter, communicationRouter, schedulingRouter, clinicalRouter, certificateRouter, instructionRouter, billingRouter, accountingRouter, hrRouter, notificationsRouter, insightsRouter, adminRouter];
