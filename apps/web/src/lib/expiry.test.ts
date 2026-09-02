import { describe, expect, it } from 'vitest';
import { timeLeft } from './expiry.js';

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('how long a preview has left', () => {
  it('says nothing about one that is kept', () => {
    expect(timeLeft(null)).toBeNull();
  });

  it('counts whole days once there is more than one', () => {
    expect(timeLeft(inMs(7 * 86_400_000 - 1_000))?.days).toBe(6);
    expect(timeLeft(inMs(30 * 86_400_000 - 1_000))?.days).toBe(29);
    expect(timeLeft(inMs(20 * 3_600_000))?.days).toBe(0);
  });

  it('counts down in whole hours while there are hours left', () => {
    expect(timeLeft(inMs(24 * 3_600_000 - 1_000))?.hours).toBe(23);
    expect(timeLeft(inMs(90 * 60_000))?.hours).toBe(1);
  });

  /*
   * Under an hour the caller switches to minutes, so "0 hours" has to still
   * carry a usable minute count rather than round to nothing.
   */
  it('keeps a usable count in the last hour', () => {
    expect(timeLeft(inMs(45 * 60_000))).toMatchObject({ hours: 0, minutes: 45 });
    expect(timeLeft(inMs(20_000))).toMatchObject({ hours: 0, minutes: 1 });
  });

  it('says nothing once it is past, rather than counting backwards', () => {
    expect(timeLeft(inMs(-1_000))).toBeNull();
    expect(timeLeft('not a date')).toBeNull();
  });
});
