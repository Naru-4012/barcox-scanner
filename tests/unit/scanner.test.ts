import { describe, expect, it } from 'vitest'
import { BarcodeFormat } from '@zxing/library'
import { SUPPORTED_BARCODE_FORMATS } from '../../src/features/scanner/components/CameraScanner'
import { formatWeight, getCatalogLookupCode, getItemDisplayName, getNextItemNumber, getScanTypeFromFormat, isCatalogCodeCandidate, parseQr } from '../../src/features/scanner/services/scanner'
import { isKeyboardScannerBurst, resolveScanInput, updateScannerKeyTiming } from '../../src/utils/scannerKeyboard'

describe('scanner parsing logic', () => {
  it('enables the requested jewellery label symbologies for camera scans', () => {
    expect(SUPPORTED_BARCODE_FORMATS).toEqual(expect.arrayContaining([
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.MICRO_QR_CODE,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]))
  })

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

  it('classifies ZXing numeric enum values as QR formats', () => {
    expect(getScanTypeFromFormat('11')).toBe('qr')
    expect(getScanTypeFromFormat('17')).toBe('qr')
    expect(getScanTypeFromFormat('5')).toBe('barcode')
    expect(parseQr('Weight: 3.25g', '', '11')).toMatchObject({ weight: 3.25, scanType: 'qr' })
    expect(parseQr('Weight: 3.25g', '', '17')).toMatchObject({ weight: 3.25, scanType: 'qr' })
    expect(parseQr('Weight: 3.25g', '', '5')).toMatchObject({ weight: 3.25, scanType: 'barcode' })
  })

  it('parses jewelry label text with net weight and size', () => {
    const parsed = parseQr('LDK\nSIZE: 6.5\nNW: 38.5', '', 'QR_CODE')
    expect(parsed).toMatchObject({
      product: 'LDK',
      size: '6.5',
      weight: 38.5,
      unit: 'g',
      scanType: 'qr',
    })
  })

  it('extracts net rather than gross weight when both are encoded', () => {
    const parsed = parseQr('FTP74\nG.W.: 1.758\nN.W.: 1.748', '', 'QR_CODE')
    expect(parsed).toMatchObject({ product: 'FTP74', weight: 1.748, unit: 'g', scanType: 'qr' })
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
    const parsed = parseQr('(3103)005660', '')
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return

    expect(parsed.weight).toBe(5.66)
    expect(parsed.unit).toBe('kg')
    expect(formatWeight(parsed.weight, parsed.unit)).toBe('5,660 g')
  })

  it('parses GS1 DataMatrix identifiers and net weight', () => {
    const parsed = parseQr(']d2(01)09506000134352(21)FTP74(3103)001748', '', 'DATA_MATRIX')
    expect(parsed).toMatchObject({
      product: '09506000134352',
      weight: 1.748,
      unit: 'kg',
      scanType: 'barcode',
    })
  })

  it('parses GS1 DataMatrix payloads separated by group separators', () => {
    const parsed = parseQr(']d20109506000134352\u001d3103001748', '', 'DATA_MATRIX')
    expect(parsed).toMatchObject({
      product: '09506000134352',
      weight: 1.748,
      unit: 'kg',
    })
  })

  it('parses structured jewelry QR payloads with item, purity, net weight and size', () => {
    const parsed = parseQr('{"sku":"FTP74","purity":"22K","netWeight":1.748,"unit":"g","size":"6.5"}', '', 'QR_CODE')
    expect(parsed).toMatchObject({
      product: 'FTP74',
      weight: 1.748,
      unit: 'g',
      size: '6.5',
      purity: '22K',
      scanType: 'qr',
    })
  })

  it('respects explicit weight units in structured payloads', () => {
    expect(parseQr('{"productId":"RING-1","netWeight":"1.25 kg"}', '', 'QR_CODE')).toMatchObject({
      product: 'RING-1',
      weight: 1.25,
      unit: 'kg',
    })
    expect(parseQr('{"productId":"RING-2","weightKg":1.25}', '', 'QR_CODE')).toMatchObject({
      product: 'RING-2',
      weight: 1.25,
      unit: 'kg',
    })
  })

  it('parses purity from key-value jewelry QR payloads', () => {
    const parsed = parseQr('SKU: FTP74\nNW: 1.748g\nPurity: 22K\nSize: 6.5', '', 'QR_CODE')
    expect(parsed).toMatchObject({
      product: 'FTP74',
      weight: 1.748,
      unit: 'g',
      size: '6.5',
      purity: '22K',
    })
  })

  it('does not interpret numeric product IDs as weights', () => {
    expect(parseQr('00090110', '')).toMatchObject({
      error: 'No weight found. Enter the item weight manually to keep the scanned code.',
    })
  })

  it('recognizes the FTP22 label as an item code, never as a weight', () => {
    expect(getCatalogLookupCode('FTP22')).toBe('FTP22')
    expect(parseQr('FTP22', '', 'QR_CODE')).toMatchObject({
      error: 'No weight found. Enter the item weight manually to keep the scanned code.',
    })
    expect(parseQr('FTP22', '3.25', 'QR_CODE')).toMatchObject({
      raw: 'FTP22',
      product: 'FTP22',
      weight: 3.25,
      unit: 'g',
      scanType: 'qr',
    })
  })

  it('recognizes safe bare product codes for catalogue lookup', () => {
    expect(isCatalogCodeCandidate('  ftp74  ')).toBe(true)
    expect(isCatalogCodeCandidate('00090110')).toBe(true)
    expect(isCatalogCodeCandidate('FTP74\nNW: 1.2')).toBe(false)
    expect(isCatalogCodeCandidate('x'.repeat(129))).toBe(false)
  })

  it('extracts catalogue identifiers from structured, GS1, and labeled code-only payloads', () => {
    expect(getCatalogLookupCode('{"sku":"FTP74","purity":"22K"}')).toBe('FTP74')
    expect(getCatalogLookupCode(']d2(01)09506000134352(21)FTP74')).toBe('FTP74')
    expect(getCatalogLookupCode('SKU: FTP74\nPurity: 22K')).toBe('FTP74')
    expect(getCatalogLookupCode('FTP74')).toBe('FTP74')
    expect(getCatalogLookupCode('{"purity":"22K"}')).toBeNull()
  })

  it('continues to accept decimal-only weights from barcode readers', () => {
    expect(parseQr('011.0', '')).toMatchObject({ weight: 11, unit: 'g', scanType: 'barcode' })
  })

  it('preserves hundredth-gram precision for both manual entry and barcode scans', () => {
    expect(parseQr('', '42.44')).toMatchObject({ weight: 42.44, unit: 'g', scanType: 'manual' })
    expect(parseQr('42.44', '')).toMatchObject({ weight: 42.44, unit: 'g', scanType: 'barcode' })
    expect(formatWeight(42.44)).toBe('42.44 g')
  })

  it('does not guess decimal placement for digit-only barcode payloads', () => {
    expect(parseQr('42442', '')).toMatchObject({
      error: 'No weight found. Enter the item weight manually to keep the scanned code.',
    })
  })

  it('extracts a decimal weight appended directly to an alphanumeric barcode value', () => {
    expect(parseQr('theremi36.3', '', 'CODE_128')).toMatchObject({
      product: 'theremi',
      weight: 36.3,
      unit: 'g',
      scanType: 'barcode',
    })
  })

  it('keeps a product-only QR payload when its printed weight is entered manually', () => {
    const parsed = parseQr('FTP74', '38.5', 'QR_CODE')
    expect(parsed).toMatchObject({
      raw: 'FTP74',
      product: 'FTP74',
      weight: 38.5,
      unit: 'g',
      scanType: 'qr',
    })
  })

  it('keeps a numeric product ID distinct from its manually entered weight', () => {
    expect(parseQr('00090110', '9.2', 'QR_CODE')).toMatchObject({
      raw: '00090110',
      product: '00090110',
      weight: 9.2,
      scanType: 'qr',
    })
  })

  it('does not mistake numeric item numbers for delimited weights', () => {
    const parsed = parseQr('ITEM-01, 25.50, 8', '')
    expect(parsed).toMatchObject({ product: 'ITEM-01', weight: 25.5 })
  })

  it('converts kilograms and milligrams to grams for displayed totals', () => {
    expect(formatWeight(2.5, 'kg')).toBe('2,500 g')
    expect(formatWeight(250, 'mg')).toBe('0.25 g')
  })

  it('rejects invalid or zero weight', () => {
    expect(parseQr('', '0')).toMatchObject({ error: 'Weight must be greater than zero.' })
    expect(parseQr('', 'abc')).toMatchObject({ error: 'We could not find a valid weight in that scan.' })
  })

  it('rejects more than three decimals', () => {
    const parsed = parseQr('', '12.3456')
    expect(parsed).toMatchObject({ error: 'Weight can have up to 3 decimal places.' })
  })

  it('rejects weights outside the supported database range', () => {
    expect(parseQr('', '1000000000')).toMatchObject({
      error: 'Weight exceeds the maximum supported value.',
    })
    expect(parseQr('', '999999999.999')).toMatchObject({ weight: 999999999.999 })
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

describe('item numbering', () => {
  it('uses the current item count rather than the highest possibly stale number', () => {
    expect(getNextItemNumber([{ itemNumber: 1 }, { itemNumber: 3 }])).toBe(3)
    expect(getNextItemNumber([])).toBe(1)
  })
})

describe('keyboard scanner input', () => {
  it('recognizes fast scanner keystrokes but not slowly typed values', () => {
    let timing = { lastKeyAt: 0, fastKeyCount: 0 }
    for (const [index, key] of [...'42442'].entries()) {
      timing = updateScannerKeyTiming(timing, key, 1000 + index * 10)
    }
    expect(isKeyboardScannerBurst(timing, 1060)).toBe(true)

    timing = updateScannerKeyTiming({ lastKeyAt: 1000, fastKeyCount: 4 }, '4', 1100)
    expect(isKeyboardScannerBurst(timing, 1110)).toBe(false)
  })

  it('keeps a pending camera scan associated with a rapidly entered manual weight', () => {
    const result = resolveScanInput(
      '42.44',
      { lastKeyAt: 1040, fastKeyCount: 5 },
      1050,
      { raw: 'QR-ITEM-1', format: 'QR_CODE' },
    )

    expect(result).toEqual({
      raw: 'QR-ITEM-1',
      manualWeight: '42.44',
      format: 'QR_CODE',
    })
  })
})
