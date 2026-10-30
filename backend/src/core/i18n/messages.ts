/** Server-side catalog for emails, WhatsApp texts and PDFs (02 §2 core/i18n). */
export type Lang = 'ar' | 'en';

const catalog = {
  ar: {
    'email.footer': 'هذه رسالة تلقائية من {{app}}. يرجى عدم الرد عليها.',
    'email.otp.subject': 'رمز التحقق: {{code}}',
    'email.otp.title': 'رمز التحقق الخاص بك',
    'email.otp.body': 'استخدم الرمز التالي لإكمال العملية. ينتهي خلال {{minutes}} دقائق.',
    'email.otp.ignore': 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.',
    'email.invite.subject': 'دعوة للانضمام إلى {{clinic}}',
    'email.invite.title': 'مرحبًا {{name}}',
    'email.invite.body': 'تمت دعوتك للانضمام إلى {{clinic}} على {{app}}. اضغط على الزر لتعيين كلمة المرور وتفعيل حسابك. الرابط صالح لمدة 7 أيام.',
    'email.invite.button': 'تفعيل الحساب',
    'email.passwordChanged.subject': 'تم تغيير كلمة المرور',
    'email.passwordChanged.body': 'تم تغيير كلمة مرور حسابك. إذا لم تقم بذلك، تواصل مع الدعم فورًا.',
    'email.generic.subject': '{{subject}}',
    'email.tomorrow.subject': 'مواعيد الغد — {{date}}',
    'email.tomorrow.title': 'لديكم {{count}} موعدًا غدًا',
    'email.reminder.subject': 'تذكير بموعدك في {{clinic}}',
    'email.reminder.body': 'نذكّرك بموعدك مع {{dentist}} يوم {{date}} الساعة {{time}}.',
    'email.booked.subject': 'تم تأكيد موعدك في {{clinic}}',
    'email.booked.body': 'تم حجز موعدك مع {{dentist}} يوم {{date}} الساعة {{time}}.',
    'email.cancelled.subject': 'تم إلغاء موعدك في {{clinic}}',
    'email.cancelled.body': 'تم إلغاء موعدك يوم {{date}} الساعة {{time}}.',
    'email.rescheduled.subject': 'تم تغيير موعدك في {{clinic}}',
    'email.rescheduled.body': 'موعدك الجديد مع {{dentist}} يوم {{date}} الساعة {{time}}.',
    'email.recall.subject': 'حان وقت زيارتك الدورية في {{clinic}}',
    'email.recall.body': 'حان موعد {{type}}. احجز موعدك من البوابة أو اتصل بنا.',
    'email.invoice.subject': 'فاتورة {{number}} من {{clinic}}',
    'email.invoice.body': 'مرفق فاتورتك رقم {{number}} بقيمة {{amount}}.',
    'email.receipt.subject': 'إيصال {{number}} من {{clinic}}',
    'email.receipt.body': 'شكرًا لك. استلمنا دفعتك بقيمة {{amount}}.',
    'email.alert.subject': 'تنبيه: {{title}}',
  },
  en: {
    'email.footer': 'This is an automatic message from {{app}}. Please do not reply.',
    'email.otp.subject': 'Your verification code: {{code}}',
    'email.otp.title': 'Your verification code',
    'email.otp.body': 'Use this code to continue. It expires in {{minutes}} minutes.',
    'email.otp.ignore': "If you didn't request this code, you can safely ignore this email.",
    'email.invite.subject': 'Invitation to join {{clinic}}',
    'email.invite.title': 'Hello {{name}}',
    'email.invite.body': "You've been invited to join {{clinic}} on {{app}}. Click the button to set your password and activate your account. The link is valid for 7 days.",
    'email.invite.button': 'Activate account',
    'email.passwordChanged.subject': 'Your password was changed',
    'email.passwordChanged.body': "Your account password was changed. If this wasn't you, contact support immediately.",
    'email.generic.subject': '{{subject}}',
    'email.tomorrow.subject': "Tomorrow's appointments — {{date}}",
    'email.tomorrow.title': 'You have {{count}} appointments tomorrow',
    'email.reminder.subject': 'Reminder: your appointment at {{clinic}}',
    'email.reminder.body': 'This is a reminder of your appointment with {{dentist}} on {{date}} at {{time}}.',
    'email.booked.subject': 'Your appointment at {{clinic}} is booked',
    'email.booked.body': 'Your appointment with {{dentist}} is booked for {{date}} at {{time}}.',
    'email.cancelled.subject': 'Your appointment at {{clinic}} was cancelled',
    'email.cancelled.body': 'Your appointment on {{date}} at {{time}} was cancelled.',
    'email.rescheduled.subject': 'Your appointment at {{clinic}} was changed',
    'email.rescheduled.body': 'Your new appointment with {{dentist}} is on {{date}} at {{time}}.',
    'email.recall.subject': "It's time for your check-up at {{clinic}}",
    'email.recall.body': "It's time for your {{type}}. Book from the portal or call us.",
    'email.invoice.subject': 'Invoice {{number}} from {{clinic}}',
    'email.invoice.body': 'Attached is your invoice {{number}} for {{amount}}.',
    'email.receipt.subject': 'Receipt {{number}} from {{clinic}}',
    'email.receipt.body': 'Thank you. We received your payment of {{amount}}.',
    'email.alert.subject': 'Alert: {{title}}',
  },
} as const;

export type MessageKey = keyof (typeof catalog)['en'];

export function tr(lang: Lang, key: MessageKey, params: Record<string, string | number> = {}): string {
  const template: string = catalog[lang][key] ?? catalog.en[key];
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? ''));
}

export const MESSAGE_KEYS = Object.keys(catalog.en) as MessageKey[];
export const _catalogForTests = catalog;
