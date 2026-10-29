import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '@/config/logger';

describe('log redaction', () => {
  it('never writes secrets, tokens, OTPs or national ids', () => {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += String(chunk);
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
    log.info(
      {
        req: { headers: { authorization: 'Bearer abc.def', cookie: 'eld_rt=xyz' } },
        body: { password: 'Password123!', code: '123456', nationalId: '9871234567', phone: '+962791234567' },
        token: 'secret-token',
      },
      'test',
    );
    expect(out).not.toContain('abc.def');
    expect(out).not.toContain('eld_rt=xyz');
    expect(out).not.toContain('Password123!');
    expect(out).not.toContain('123456');
    expect(out).not.toContain('9871234567');
    expect(out).not.toContain('+962791234567');
    expect(out).not.toContain('secret-token');
    expect(out).toContain('[REDACTED]');
  });
});
