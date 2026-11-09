export type ScannerKeyTiming = {
  lastKeyAt: number
  fastKeyCount: number
}

export function updateScannerKeyTiming(previous: ScannerKeyTiming, key: string, timestamp: number): ScannerKeyTiming {
  if (key.length !== 1) return previous

  return {
    lastKeyAt: timestamp,
    fastKeyCount: timestamp - previous.lastKeyAt <= 60 ? previous.fastKeyCount + 1 : 1,
  }
}

export function isKeyboardScannerBurst(timing: ScannerKeyTiming, timestamp: number): boolean {
  return timing.fastKeyCount >= 4 && timestamp - timing.lastKeyAt < 1000
}
