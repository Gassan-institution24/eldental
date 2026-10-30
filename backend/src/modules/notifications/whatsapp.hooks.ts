import { logger } from '@/config/logger';
import type { Lang } from '@/core/i18n/messages';
import { enqueue } from '@/core/jobs/queue';

/**
 * WhatsApp entry points used by other modules. The Mazbot client and its credentials
 * (platformSettings, entered by the superadmin) are wired in the notifications module;
 * when WhatsApp is not configured these calls are no-ops that only log.
 */
export async function sendOtpWhatsApp(phone: string, lang: Lang, code: string): Promise<void> {
  try {
    await enqueue('notifications', 'whatsapp.send', { to: phone, template: 'otp', lang, params: { code }, relatedType: 'otp' });
  } catch (err) {
    logger.warn({ err }, 'whatsapp otp not queued');
  }
}
