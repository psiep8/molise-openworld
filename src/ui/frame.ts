/**
 * Wait for a paint opportunity when available, but don't let background-tab
 * requestAnimationFrame throttling block asynchronous startup indefinitely.
 */
export function nextFrameOrTimeout(timeoutMs = 100): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    else finish();
  });
}
