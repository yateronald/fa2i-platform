/**
 * Vitest global setup for FA2I backend tests.
 *
 * Configures fast-check with a minimum of 100 runs per property.
 */
import * as fc from 'fast-check';

fc.configureGlobal({
  numRuns: 100,
});
