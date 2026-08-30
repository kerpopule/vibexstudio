/**
 * How many AI turns may stream at once. Turns are network-bound, so the
 * ceiling exists to protect memory and battery on small devices — it scales
 * with hardware instead of being a flat "one at a time".
 */

const GB = 1024 * 1024 * 1024;

/**
 * Concurrent-turn ceiling for a device with `totalMemoryBytes` of RAM
 * (null when the platform doesn't report it — assume mid-range).
 * Thresholds sit below the marketed sizes (7.5 for "8 GB") because the OS
 * reports usable memory, not the sticker number.
 */
export function turnLimitForMemory(totalMemoryBytes: number | null): number {
  if (totalMemoryBytes == null) return 3;
  if (totalMemoryBytes >= 7.5 * GB) return 4;
  if (totalMemoryBytes >= 3.5 * GB) return 3;
  return 2;
}
