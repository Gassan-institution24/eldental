import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from '@/i18n';
import { setTelemetryEnabled } from '@/lib/telemetry';

setTelemetryEnabled(false);
void i18n.changeLanguage('en');

afterEach(() => {
  cleanup();
});

// jsdom lacks these browser APIs used by MUI / our hooks.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: () => undefined,
    writable: true,
  });
}

// React Router's data router builds a fetch `Request` for every navigation. Under jsdom the
// `AbortSignal` comes from jsdom while `Request` is Node's own, which rejects it (Node ≥ 22),
// so navigations (including setSearchParams) silently fail in tests. Tests have no loaders to
// abort, so the signal is dropped.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.signal) {
      const { signal: _signal, ...rest } = init;
      super(input, rest);
    } else super(input, init);
  }
} as typeof Request;
