import { Queue, Worker, type Job, type JobsOptions, type RepeatOptions } from 'bullmq';
import { isTest } from '@/config/env';
import { logger } from '@/config/logger';
import { createRedisConnection, isRedisAvailable } from '@/config/redis';
import { requestContext } from '../context/requestContext';
import { recordSystemError } from '../logging/systemErrors.service';

/** BullMQ queues (02_ARCHITECTURE.md §7). */
export const QUEUES = ['notifications', 'reminders', 'recalls', 'einvoice', 'reports', 'maintenance'] as const;
export type QueueName = (typeof QUEUES)[number];

type Handler = (data: Record<string, unknown>, job?: Job) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const queues = new Map<QueueName, Queue>();
const workers: Worker[] = [];
const repeatables: { queue: QueueName; name: string; data: Record<string, unknown>; repeat: RepeatOptions; jobId: string }[] = [];

/** In tests jobs run inline (after the caller's commit) and are recorded here. */
export const testJobLog: { queue: QueueName; name: string; data: Record<string, unknown>; opts?: JobsOptions }[] = [];
let inlineInTests = true;
export function setInlineJobs(v: boolean): void {
  inlineInTests = v;
}

const key = (queue: QueueName, name: string) => `${queue}:${name}`;

/** Registers the handler of a job name (call at module load). */
export function defineJob(queue: QueueName, name: string, handler: Handler): void {
  handlers.set(key(queue, name), handler);
}

function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: createRedisConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
    queues.set(name, q);
  }
  return q;
}

/** Adds a job. Carries the tenant id in the payload (`clinicId`) so workers re-enter the tenant. */
export async function enqueue(queue: QueueName, name: string, data: Record<string, unknown>, opts: JobsOptions = {}): Promise<void> {
  const ctx = requestContext.get();
  const payload = { ...data, ...(data.clinicId || !ctx?.clinicId ? {} : { clinicId: String(ctx.clinicId) }) };
  if (isTest) {
    testJobLog.push({ queue, name, data: payload, opts });
    if (inlineInTests && !opts.delay) await runHandler(queue, name, payload);
    return;
  }
  if (!isRedisAvailable()) {
    // Dev without Redis: run in-process (delayed jobs on a timer, lost on restart).
    runWithoutRedis(queue, name, payload, opts);
    return;
  }
  await getQueue(queue).add(name, payload, opts);
}

const memoryTimers = new Map<string, NodeJS.Timeout>();

function runWithoutRedis(queue: QueueName, name: string, data: Record<string, unknown>, opts: JobsOptions): void {
  const run = () =>
    void runHandler(queue, name, data).catch((err: unknown) => {
      logger.error({ err, queue, job: name }, 'in-memory job failed');
      void recordSystemError({ error: err, source: 'job', route: `${queue}:${name}` });
    });
  const delay = opts.delay ?? 0;
  if (delay <= 0) return void setImmediate(run);
  if (delay > 2 ** 31 - 1) return; // beyond setTimeout range; dev only
  const t = setTimeout(() => {
    if (opts.jobId) memoryTimers.delete(String(opts.jobId));
    run();
  }, delay);
  t.unref();
  if (opts.jobId) {
    clearTimeout(memoryTimers.get(String(opts.jobId)));
    memoryTimers.set(String(opts.jobId), t);
  }
}

export async function removeJob(queue: QueueName, jobId: string): Promise<void> {
  if (isTest) {
    const i = testJobLog.findIndex((j) => j.queue === queue && j.opts?.jobId === jobId);
    if (i >= 0) testJobLog.splice(i, 1);
    return;
  }
  if (!isRedisAvailable()) {
    clearTimeout(memoryTimers.get(jobId));
    memoryTimers.delete(jobId);
    return;
  }
  const job = await getQueue(queue).getJob(jobId);
  await job?.remove().catch(() => undefined);
}

async function runHandler(queue: QueueName, name: string, data: Record<string, unknown>, job?: Job): Promise<unknown> {
  const h = handlers.get(key(queue, name));
  if (!h) throw new Error(`No handler for job ${queue}:${name}`);
  const clinicId = typeof data.clinicId === 'string' ? data.clinicId : undefined;
  return requestContext.run({ ...(clinicId ? { clinicId } : { skipTenant: true }), reqId: job?.id ? `job:${job.id}` : 'job' }, () => h(data, job));
}

/** Repeatable jobs are registered once via BullMQ repeat options (safe with many API instances). */
export function defineRepeatable(queue: QueueName, name: string, repeat: RepeatOptions, data: Record<string, unknown> = {}): void {
  repeatables.push({ queue, name, data, repeat, jobId: `repeat:${queue}:${name}` });
}

export async function startWorkers(): Promise<void> {
  if (isTest || workers.length) return;
  if (!isRedisAvailable()) {
    logger.warn('Redis unavailable: jobs run in-process and repeatable jobs are disabled');
    return;
  }
  for (const qn of QUEUES) {
    const w = new Worker(qn, (job) => runHandler(qn, job.name, job.data as Record<string, unknown>, job), {
      connection: createRedisConnection(),
      concurrency: qn === 'notifications' ? 1 : 4,
    });
    w.on('failed', (job, err) => {
      logger.error({ err, queue: qn, job: job?.name }, 'job failed');
      void recordSystemError({ error: err, source: 'job', route: `${qn}:${job?.name ?? '?'}` });
    });
    workers.push(w);
  }
  for (const r of repeatables) {
    await getQueue(r.queue).upsertJobScheduler(r.jobId, r.repeat, { name: r.name, data: r.data });
  }
  logger.info({ queues: QUEUES.length, repeatables: repeatables.length }, 'workers started');
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}

/** Runs a job handler directly (tests and the admin "run now" button). */
export function runJobNow(queue: QueueName, name: string, data: Record<string, unknown> = {}): Promise<unknown> {
  return runHandler(queue, name, data);
}
