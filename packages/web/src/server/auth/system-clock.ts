import type { Clock } from '@algerknown/governed';

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
