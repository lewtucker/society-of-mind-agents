/**
 * Server-side demo state — shared across the SSE route and the step/reset API routes.
 * Module-level state persists within the Next.js dev server process.
 */

let _frame = 0;
const _waiters: Array<() => void> = [];

export function getFrame(): number {
  return _frame;
}

export function step(): void {
  _frame++;
  const ws = _waiters.splice(0);
  for (const w of ws) w();
}

export function reset(): void {
  _frame = 0;
  // Don't notify waiters — they'll get the reset state on the next step
}

/** Resolves the next time step() is called. */
export function waitForStep(): Promise<void> {
  return new Promise((resolve) => {
    _waiters.push(resolve);
  });
}
