/**
 * Random id per browser session, sent as `X-Session-Id` so all five log streams can be
 * joined into one user timeline (15_LOGGING_AND_MONITORING.md §1).
 */
const KEY = 'eld.sid';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let memoryId: string | null = null;

export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = randomId();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    memoryId = memoryId ?? randomId();
    return memoryId;
  }
}

/** A new session starts on every login. */
export function rotateSessionId(): string {
  const id = randomId();
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    memoryId = id;
  }
  return id;
}
