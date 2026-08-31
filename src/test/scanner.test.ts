import { describe, expect, it } from 'vitest'
import { findDuplicateItem, getItemDisplayName, parseQr } from '../services/scanner'

describe('scanner parsing logic', () => {
  it('parses a QR payload with weight and product name', () => {
    const parsed = parseQr('ABC-100\nWeight: 250g', '')

    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return

    expect(parsed.weight).toBe(250)
    expect(parsed.unit).toBe('g')
    expect(parsed.product).toBe('ABC-100')
    expect(parsed.raw).toBe('ABC-100\nWeight: 250g')
    expect(parsed.scanType).toBe('qr')
  })

  it('accepts a bare numeric weight input', () => {
    const parsed = parseQr('', '42.5')

    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return

    expect(parsed.weight).toBe(42.5)
    expect(parsed.unit).toBe('g')
    expect(parsed.product).toBeUndefined()
    expect(parsed.scanType).toBe('manual')
  })

  it('parses 1D barcode tagged formats (NW:, WT:, N.W.:, Net Wt:)', () => {
    const parsedNw = parseQr('NW: 56.60g', '')
    expect('error' in parsedNw).toBe(false)
    if (!('error' in parsedNw)) {
      expect(parsedNw.weight).toBe(56.6)
      expect(parsedNw.unit).toBe('g')
      expect(parsedNw.scanType).toBe('barcode')
    }

    const parsedWt = parseQr('WT: 25.40', '')
    expect('error' in parsedWt).toBe(false)
    if (!('error' in parsedWt)) {
      expect(parsedWt.weight).toBe(25.4)
      expect(parsedWt.unit).toBe('g')
      expect(parsedWt.scanType).toBe('barcode')
    }

    const parsedNetWt = parseQr('Net Wt.: 12.350 gm', '')
    expect('error' in parsedNetWt).toBe(false)
    if (!('error' in parsedNetWt)) {
      expect(parsedNetWt.weight).toBe(12.35)
      expect(parsedNetWt.unit).toBe('g')
    }
  })

  it('parses delimited barcode strings with product, weight, and size', () => {
    const parsed = parseQr('LDK Payal | 56.60g | Size: 10.0"', '')
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return

    expect(parsed.weight).toBe(56.6)
    expect(parsed.unit).toBe('g')
    expect(parsed.product).toBe('LDK Payal')
    expect(parsed.size).toBe('10.0')
  })

  it('parses GS1 weight barcode format', () => {
    const parsed = parseQr('(3102)005660', '')
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return

    expect(parsed.weight).toBe(56.6)
    expect(parsed.unit).toBe('g')
  })

  it('rejects invalid or zero weight', () => {
    expect(parseQr('', '0')).toMatchObject({ error: 'Weight must be greater than zero.' })
    expect(parseQr('', 'abc')).toMatchObject({ error: 'We could not find a valid weight in that scan.' })
  })

  it('rejects more than three decimals', () => {
    const parsed = parseQr('', '12.3456')
    expect(parsed).toMatchObject({ error: 'Weight can have up to 3 decimal places.' })
  })

  it('rejects oversized scanner input', () => {
    expect(parseQr('x'.repeat(2049), '')).toMatchObject({ error: 'Input is too long.' })
  })

  it('builds unique display names when product is undefined or provided', () => {
    expect(getItemDisplayName(undefined, 1, 'manual')).toBe('Manual Weight 001')
    expect(getItemDisplayName(undefined, 2, 'qr')).toBe('QR Scanned 002')
    expect(getItemDisplayName(undefined, 3, 'barcode')).toBe('Barcode Scanned 003')
    expect(getItemDisplayName('Gold ring', 4, 'qr')).toBe('Gold ring')
  })

  it('records whether the weight came from a QR scan, barcode scan, or manual entry', () => {
    expect(parseQr('ABC-100\nWeight: 250g', '')).toMatchObject({ scanType: 'qr' })
    expect(parseQr('NW: 42.5g', '')).toMatchObject({ scanType: 'barcode' })
    expect(parseQr('', '42.5')).toMatchObject({ scanType: 'manual' })
  })
})

describe('duplicate detection', () => {
  it('detects duplicate raw payloads case-insensitively', () => {
    const items = [
      { id: '1', itemNumber: 1, raw: 'ABC-100\nWeight: 250g', product: 'ABC-100', weight: 250, unit: 'g', scannedAt: '2026-01-01T00:00:00.000Z' },
      { id: '2', itemNumber: 2, raw: 'XYZ-50\nWeight: 50g', product: 'XYZ-50', weight: 50, unit: 'g', scannedAt: '2026-01-01T00:00:00.000Z' },
    ]

    expect(findDuplicateItem(items, 'abc-100\nweight: 250g')?.id).toBe('1')
    expect(findDuplicateItem(items, 'new-item')?.id).toBeUndefined()
  })
})
