import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextFrameOrTimeout } from '../src/ui/frame';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('nextFrameOrTimeout', () => {
  it('resolves when animation frames are throttled in a background tab', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));

    const pending = nextFrameOrTimeout();
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toBeUndefined();
  });

  it('resolves on the next animation frame when one is available', async () => {
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);

    await expect(nextFrameOrTimeout()).resolves.toBeUndefined();
    expect(requestFrame).toHaveBeenCalledOnce();
  });
});
