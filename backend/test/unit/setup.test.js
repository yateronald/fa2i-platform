import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Test setup', () => {
  it('fast-check is configured with at least 100 runs', () => {
    let runCount = 0;
    fc.assert(
      fc.property(fc.integer(), () => {
        runCount++;
        return true;
      })
    );
    expect(runCount).toBeGreaterThanOrEqual(100);
  });
});
