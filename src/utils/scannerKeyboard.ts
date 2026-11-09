export type ScannerKeyTiming = {
  lastKeyAt: number
  fastKeyCount: number
}

export type PendingScan = { raw: string; format?: string }
export type ResolvedScanInput = { raw: string; manualWeight: string; format?: string }

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

export function resolveScanInput(
  input: string,
  timing: ScannerKeyTiming,
  timestamp: number,
  pendingScan: PendingScan | null,
  inputFormat?: string,
): ResolvedScanInput {
  if (pendingScan) {
    return {
      raw: pendingScan.raw,
      manualWeight: input,
      format: pendingScan.format ?? inputFormat,
    }
  }

  if (isKeyboardScannerBurst(timing, timestamp)) {
    return { raw: input, manualWeight: '', format: inputFormat }
  }

  return { raw: '', manualWeight: input, format: inputFormat }
}
