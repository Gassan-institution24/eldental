import type { Router } from 'express';
import { authRouter } from './auth/auth.routes';
import { contactRouter } from './public/contact';
import { rolesRouter } from './roles/roles.routes';
import { staffRouter } from './staff/staff.routes';
import { telemetryRouter } from './telemetry/telemetry.routes';

/** Every feature module's router. Each router declares its own full paths (e.g. `/patients`). */
export const moduleRouters: Router[] = [authRouter, telemetryRouter, staffRouter, rolesRouter, contactRouter];
