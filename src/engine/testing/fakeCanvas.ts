/** A recording stand-in for CanvasRenderingContext2D, for tests in jsdom (which has no canvas). */

export interface FakeContext {
  ctx: CanvasRenderingContext2D;
  /** Every method call in order, e.g. ['save', 'fillRect', ...]. */
  calls: string[];
  /** Arguments of every fillText call. */
  texts: string[];
  count(method: string): number;
}

export function makeFakeContext(): FakeContext {
  const calls: string[] = [];
  const texts: string[] = [];
  const state: Record<string, unknown> = {};
  const gradient = { addColorStop: () => undefined };
  const target = {};
  const ctx = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => {
          calls.push(prop);
          return gradient;
        };
      }
      if (prop === 'measureText') {
        return (text: string) => {
          calls.push(prop);
          return { width: text.length * 8 };
        };
      }
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        calls.push(prop);
        if (prop === 'fillText' && typeof args[0] === 'string') texts.push(args[0]);
        return undefined;
      };
    },
    set(_t, prop: string, value: unknown) {
      state[prop] = value;
      return true;
    },
    has() {
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, texts, count: (method) => calls.filter((c) => c === method).length };
}
