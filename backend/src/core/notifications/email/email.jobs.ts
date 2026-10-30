import { defineJob } from '@/core/jobs/queue';
import { deliverEmail, type EmailMessage } from './email.service';

defineJob('notifications', 'email.send', async (data) => {
  await deliverEmail(data as unknown as EmailMessage);
});
