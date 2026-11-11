import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '@/config/env';
import { logger } from '@/config/logger';
import { tr, type Lang } from '@/core/i18n/messages';
import { enqueue } from '@/core/jobs/queue';
import { recordSystemError } from '@/core/logging/systemErrors.service';

export type EmailMessage = { to: string; subject: string; html: string; text: string; lang: Lang; attachments?: { filename: string; content: Buffer | string; encoding?: string }[] };

/** Captured messages in tests (no SMTP). */
export const sentEmails: EmailMessage[] = [];

let transporter: Transporter | null = null;
type SmtpOverride = { host: string; port: number; secure: boolean; user?: string; password?: string; from?: string } | null;
let overrideProvider: () => Promise<SmtpOverride> = async () => null;

/** Platform settings can override SMTP (entered by the superadmin). */
export function setSmtpOverrideProvider(fn: () => Promise<SmtpOverride>): void {
  overrideProvider = fn;
  transporter = null;
}

async function getTransport(): Promise<{ t: Transporter; from: string }> {
  const o = await overrideProvider();
  if (o) {
    return {
      t: nodemailer.createTransport({ host: o.host, port: o.port, secure: o.secure, ...(o.user ? { auth: { user: o.user, pass: o.password ?? '' } } : {}) }),
      from: o.from ?? env.MAIL_FROM,
    };
  }
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  });
  return { t: transporter, from: env.MAIL_FROM };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Simple RTL-aware layout; all user values are escaped. */
export function layout(lang: Lang, parts: { title: string; paragraphs: string[]; code?: string; button?: { label: string; url: string } }): { html: string; text: string } {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const font = lang === 'ar' ? "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif" : "Inter, 'Segoe UI', Arial, sans-serif";
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#F7F9FB;font-family:${font};color:#14202B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E3E8EE;border-radius:12px">
<tr><td style="padding:24px 32px;border-bottom:1px solid #E3E8EE;font-weight:800;color:#0E7C86;font-size:20px">${esc(env.APP_NAME)}</td></tr>
<tr><td style="padding:32px" dir="${dir}">
<h1 style="margin:0 0 16px;font-size:22px">${esc(parts.title)}</h1>
${parts.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.7;font-size:15px">${esc(p)}</p>`).join('')}
${parts.code ? `<p dir="ltr" style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;margin:24px 0;color:#0E7C86">${esc(parts.code)}</p>` : ''}
${parts.button ? `<p style="text-align:center;margin:28px 0"><a href="${esc(parts.button.url)}" style="background:#0E7C86;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${esc(parts.button.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #E3E8EE;color:#5B6B7A;font-size:12px">${esc(tr(lang, 'email.footer', { app: env.APP_NAME }))}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [parts.title, ...parts.paragraphs, parts.code ?? '', parts.button ? `${parts.button.label}: ${parts.button.url}` : ''].filter(Boolean).join('\n\n');
  return { html, text };
}

/** Resend's HTTPS API (no SMTP port needed). Attachments go base64-encoded. */
export async function sendViaResend(msg: EmailMessage, apiKey: string, from: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.attachments?.length
        ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.encoding === 'base64' ? a.content : Buffer.from(a.content).toString('base64') })) }
        : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Resend explains the problem (unverified domain, test-mode recipient…); keep it, never the key.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Resend ${res.status}: ${detail}`);
  }
}

/**
 * Sends now (used by the job handler). Order: SMTP entered by the superadmin, then Resend
 * (`RESEND_API_KEY`), then the SMTP variables. Failures go to systemErrors.
 */
export async function deliverEmail(msg: EmailMessage): Promise<void> {
  if (isTest) {
    sentEmails.push(msg);
    return;
  }
  const override = await overrideProvider();
  const useResend = !override && Boolean(env.RESEND_API_KEY);
  try {
    if (useResend) {
      await sendViaResend(msg, env.RESEND_API_KEY, env.MAIL_FROM);
    } else {
      const { t, from } = await getTransport();
      await t.sendMail({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, attachments: msg.attachments });
    }
    logger.info({ subject: msg.subject, via: useResend ? 'resend' : 'smtp' }, 'email sent');
  } catch (err) {
    // Email is one integration ("smtp") in the error log; the route tells which transport failed.
    void recordSystemError({ error: err, source: 'integration', integration: 'smtp', route: useResend ? 'email.resend' : 'email' });
    throw err;
  }
}

/** Queues an email (never sent inside a transaction; call after commit). */
export async function queueEmail(msg: EmailMessage): Promise<void> {
  await enqueue('notifications', 'email.send', msg as unknown as Record<string, unknown>);
}

export const emails = {
  otp(to: string, lang: Lang, code: string) {
    const body = layout(lang, {
      title: tr(lang, 'email.otp.title'),
      paragraphs: [tr(lang, 'email.otp.body', { minutes: env.OTP_TTL_MINUTES }), tr(lang, 'email.otp.ignore')],
      code,
    });
    return queueEmail({ to, lang, subject: tr(lang, 'email.otp.subject', { code }), ...body });
  },
  invitation(to: string, lang: Lang, p: { name: string; clinic: string; url: string }) {
    const body = layout(lang, {
      title: tr(lang, 'email.invite.title', { name: p.name }),
      paragraphs: [tr(lang, 'email.invite.body', { clinic: p.clinic, app: env.APP_NAME })],
      button: { label: tr(lang, 'email.invite.button'), url: p.url },
    });
    return queueEmail({ to, lang, subject: tr(lang, 'email.invite.subject', { clinic: p.clinic }), ...body });
  },
  passwordChanged(to: string, lang: Lang) {
    const subject = tr(lang, 'email.passwordChanged.subject');
    return queueEmail({ to, lang, subject, ...layout(lang, { title: subject, paragraphs: [tr(lang, 'email.passwordChanged.body')] }) });
  },
};
