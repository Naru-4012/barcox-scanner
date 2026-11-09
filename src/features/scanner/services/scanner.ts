import { getNextSessionNumber } from '../../session/services/sessionStorage'
import type { Item, ParsedItem, ScanType } from '../../../types'

const numericQrFormats = new Set(['11', '17'])

export function getScanTypeFromFormat(format?: string): ScanType | undefined {
  if (!format) return undefined

  return format.toUpperCase().includes('QR') || numericQrFormats.has(format) ? 'qr' : 'barcode'
}

/**
 * Normalizes weight unit string to standard abbreviation (default 'g').
 */
function normalizeUnit(unitRaw?: string): string {
  if (!unitRaw) return 'g'
  const u = unitRaw.trim().toLowerCase()
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(u)) return 'g'
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(u)) return 'kg'
  if (['mg', 'mgs', 'milligram', 'milligrams'].includes(u)) return 'mg'
  return u || 'g'
}

function parseWeightToken(value: string) {
  const match = value.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*(g|gm|gms|gram|grams|mg|mgs|milligram|milligrams|kg|kgs|kilogram|kilograms)?\s*$/i)
  if (!match) return null
  return { weight: Number(match[1]), unit: normalizeUnit(match[2]) }
}

type StructuredPayload = {
  product?: string
  size?: string
  purity?: string
  weight?: { weight: number; unit: string }
}

function parseStructuredPayload(source: string): StructuredPayload | null {
  if (!source.trimStart().startsWith('{')) return null

  let payload: unknown
  try {
    payload = JSON.parse(source)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null

  const fields = payload as Record<string, unknown>
  const normalizedFields = new Map(
    Object.entries(fields).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]),
  )
  const findField = (names: string[]) => names
    .map(name => normalizedFields.get(name.replace(/[^a-z0-9]/gi, '').toLowerCase()))
    .find(value => value !== undefined && value !== null && String(value).trim() !== '')
  const productValue = findField(['sku', 'itemId', 'itemCode', 'productId', 'gtin', 'serial', 'product', 'productName', 'name', 'id'])
  const sizeValue = findField(['size', 'ringSize'])
  const purityValue = findField(['purity', 'karat', 'carat', 'fineness'])
  const unitValue = findField(['unit', 'weightUnit', 'uom'])
  const netWeightValue = findField(['netWeight', 'netWt', 'nw', 'netWeightGrams', 'netWeightKg', 'weightGrams', 'weightKg', 'weight'])
  const grossWeightValue = findField(['grossWeight', 'grossWt', 'gw'])
  const weightValue = netWeightValue ?? grossWeightValue
  const weightKey = [...normalizedFields.keys()].find(key =>
    ['netweight', 'netwt', 'nw', 'netweightgrams', 'netweightkg', 'weightgrams', 'weightkg', 'weight', 'grossweight', 'grosswt', 'gw'].includes(key) &&
    normalizedFields.get(key) === weightValue,
  )

  let weight: StructuredPayload['weight']
  if (weightValue !== undefined) {
    if (typeof weightValue === 'number' || typeof weightValue === 'string') {
      const impliedUnit = weightKey?.endsWith('kg') ? 'kg' : weightKey?.endsWith('grams') ? 'g' : String(unitValue ?? '')
      const weightText = String(weightValue).trim()
      const embeddedUnit = /[a-z]/i.test(weightText) ? parseWeightToken(weightText) : null
      const parsed = embeddedUnit ?? parseWeightToken(`${weightText}${impliedUnit}`)
      if (parsed) weight = parsed
    } else if (typeof weightValue === 'object' && !Array.isArray(weightValue)) {
      const nested = weightValue as Record<string, unknown>
      const parsed = parseWeightToken(`${nested.value ?? ''}${String(nested.unit ?? unitValue ?? '')}`)
      if (parsed) weight = parsed
    }
  }

  return {
    product: typeof productValue === 'string' || typeof productValue === 'number' ? String(productValue).trim() : undefined,
    size: typeof sizeValue === 'string' || typeof sizeValue === 'number' ? String(sizeValue).trim() : undefined,
    purity: typeof purityValue === 'string' || typeof purityValue === 'number' ? String(purityValue).trim() : undefined,
    weight,
  }
}

function parseGs1Payload(source: string) {
  const payload = source.replace(/^\]d2/i, '')
  const weightMatch = payload.match(/(?:^|[\x1d(])310([0-5])\)?([0-9]{6})(?![0-9])/i)
  const gtinMatch = payload.match(/(?:^|[\x1d(])01\)?([0-9]{14})(?![0-9])/)
  const serialMatch = payload.match(/(?:^|[\x1d(])21\)?([^\x1d()]+)/)

  return {
    weight: weightMatch
      ? { weight: Number(weightMatch[2]) / 10 ** Number(weightMatch[1]), unit: 'kg' }
      : null,
    product: gtinMatch ? gtinMatch[1] : serialMatch?.[1],
    serial: serialMatch?.[1],
  }
}

function extractWeight(source: string, allowBareNumber: boolean) {
  const gs1Weight = parseGs1Payload(source).weight
  if (gs1Weight) return gs1Weight

  const netWeightMatch = source.match(/\b(?:net\s*weight|net\s*wt|netwt|n\.?\s*w)\.?\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?/i)
  const taggedMatch = netWeightMatch ?? source.match(/\b(?:weight|gross\s*weight|gross\s*wt|g\.?\s*w|wt|w)\.?\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?/i)
  if (taggedMatch) {
    const unit = normalizeUnit(taggedMatch[2])
    if (['g', 'kg', 'mg'].includes(unit)) return { weight: Number(taggedMatch[1]), unit }
    return null
  }

  const simpleWeight = parseWeightToken(source)
  if (simpleWeight && (allowBareNumber || /[a-z]/i.test(source) || source.includes('.'))) return simpleWeight

  const combinedPayload = extractCombinedProductWeight(source)
  if (combinedPayload) return combinedPayload.weight

  if (!/[|,;/]/.test(source)) return null
  const candidates = source.split(/[|,;/]/)
    .map(part => part.trim())
    .filter(part => part && !/\bsize\b/i.test(part))
    .map(part => {
      const parsed = parseWeightToken(part)
      return parsed ? { ...parsed, explicitUnit: /[a-z]/i.test(part), decimal: part.includes('.') } : null
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)

  return candidates
    .sort((left, right) =>
      Number(right.explicitUnit) - Number(left.explicitUnit) ||
      Number(right.decimal) - Number(left.decimal),
    )[0] ?? null
}

function extractCombinedProductWeight(source: string) {
  const match = source.match(/^(.+?[a-z][a-z /_-]*?)([0-9]+(?:\.[0-9]{1,3}))\s*(g|gm|gms|gram|grams)?$/i)
  if (!match) return null

  const weight = parseWeightToken(`${match[2]}${match[3] ?? ''}`)
  return weight ? { product: match[1].trim(), weight } : null
}

function isWeightLikePart(part: string) {
  return /\b(?:weight|wt|nw|gw|size)\b/i.test(part) || parseWeightToken(part) !== null
}

export function weightInGrams(weight: number, unit = 'g') {
  const normalizedUnit = normalizeUnit(unit)
  if (normalizedUnit === 'kg') return weight * 1000
  if (normalizedUnit === 'mg') return weight / 1000
  return weight
}

export function isCatalogCodeCandidate(raw: string) {
  const code = raw.trim()
  return code.length > 0 && code.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(code)
}

export function getCatalogLookupCode(raw: string) {
  const source = raw.trim()
  const structuredProduct = parseStructuredPayload(source)?.product
  if (structuredProduct && isCatalogCodeCandidate(structuredProduct)) return structuredProduct

  const gs1 = parseGs1Payload(source)
  const gs1Product = gs1.serial ?? gs1.product
  if (gs1Product && isCatalogCodeCandidate(gs1Product)) return gs1Product

  const labeledProduct = source.match(/\b(?:sku|item\s*(?:id|code)|product\s*(?:id|code)|gtin|serial)\s*[:=]\s*([^\r\n,;|]+)/i)?.[1]?.trim()
  if (labeledProduct && isCatalogCodeCandidate(labeledProduct)) return labeledProduct

  const firstLine = source.split(/\r?\n/, 1)[0]?.trim()
  if (firstLine && firstLine !== source && isCatalogCodeCandidate(firstLine)) return firstLine
  return isCatalogCodeCandidate(source) ? source : null
}

/**
 * Parses raw barcode / QR / manual weight input.
 * Supports:
 *  - Decimal barcode weights ("011.0"), manual numeric weights ("56.6"), and explicit-unit weights ("56.60g")
 *  - Keyed weight formats ("Net Weight: 56.6g", "NW: 56.6", "N.W: 56.6", "WT: 56.6", "Net Wt: 56.6", "W: 56.6", "GW: 58.2")
 *  - Delimited barcode tags ("PAYAL | 56.60g | Size: 10", "ITEM-01, 25.50, 8", "TAG-99/12.45G")
 *  - Multi-line QR payloads (Product, Net Weight, Size)
 *  - GS1 AI weight barcodes (e.g. "(3102)005660" -> 5.660kg)
 */
export function parseQr(raw: string, manualWeight: string, format?: string): ParsedItem | { error: string } {
  if (raw.length > 2048 || manualWeight.length > 32) return { error: 'Input is too long.' }
  const source = raw.trim() || manualWeight.trim()
  if (!source) return { error: 'Enter a QR payload, barcode data, or a manual weight.' }

  const isManual = !raw.trim() && Boolean(manualWeight.trim())
  const structuredPayload = parseStructuredPayload(source)
  const gs1Payload = parseGs1Payload(source)
  const combinedPayload = extractCombinedProductWeight(source)
  let parsedWeight = structuredPayload?.weight ?? extractWeight(source, isManual)
  const manualFallback = manualWeight.trim() ? parseWeightToken(manualWeight) : null
  let usedManualFallback = false
  if (!parsedWeight && raw.trim() && manualFallback) {
    parsedWeight = manualFallback
    usedManualFallback = true
  }
  if (!parsedWeight) {
    return {
      error: isManual
        ? 'We could not find a valid weight in that scan.'
        : 'No weight found. Enter the item weight manually to keep the scanned code.',
    }
  }

  const extractedWeight = parsedWeight.weight
  const extractedUnit = parsedWeight.unit
  let extractedProduct: string | undefined
  let extractedSize: string | undefined
  let extractedPurity: string | undefined

  if (!Number.isFinite(extractedWeight)) {
    return { error: 'We could not find a valid weight in that scan.' }
  }

  if (extractedWeight <= 0) {
    return { error: 'Weight must be greater than zero.' }
  }

  // Check decimal precision (up to 3 decimal places)
  const weightStr = extractedWeight.toString()
  if (weightStr.includes('.') && weightStr.split('.')[1].length > 3) {
    return { error: 'Weight can have up to 3 decimal places.' }
  }

  // Extract Product Name and Size from payload
  const isSimpleWeight = !usedManualFallback && parseWeightToken(source) !== null
  if (!isSimpleWeight && !isManual) {
    extractedProduct = structuredPayload?.product ?? gs1Payload.product ?? combinedPayload?.product
    extractedSize = structuredPayload?.size
    extractedPurity = structuredPayload?.purity

    const productMatch = source.match(/\b(?:sku|item\s*(?:id|code)|product\s*(?:id|code|name)|gtin)\s*[:=]\s*([^\r\n,;|]+)/i)
    if (!extractedProduct && productMatch) extractedProduct = productMatch[1].trim()

    // Multi-line QR: first line is often the product description
    const lines = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (!extractedProduct && lines.length > 1) {
      // First line if it's not a weight header
      if (!/^(?:net\s*weight|weight|nw|wt)/i.test(lines[0])) {
        extractedProduct = lines[0]
      }
    } else if (!extractedProduct && /[|,;/]/.test(source)) {
      // Delimited format: take the first non-weight segment as product name
      const parts = source.split(/[|,;/]/).map(p => p.trim()).filter(Boolean)
      const nonWeightPart = parts.find(p => !isWeightLikePart(p))
      if (nonWeightPart) extractedProduct = nonWeightPart
    } else if (!extractedProduct) {
      const firstPart = source.match(/^(.*?)(?:\s*(?:net\s*weight|nw|wt|weight|size|\n|$))/i)?.[1]?.trim()
      if (firstPart && !/^[0-9.]+$/.test(firstPart)) {
        extractedProduct = firstPart
      }
    }

    // Size extraction
    const sizeMatch = source.match(/size\s*[:=-]?\s*([^\r\n,;|"]+)/i)
    if (!extractedSize && sizeMatch) {
      extractedSize = sizeMatch[1].replace(/["']+$/, '').trim()
    }
    const purityMatch = source.match(/\b(?:purity|karat|carat|fineness)\s*[:=-]?\s*([^\r\n,;|"]+)/i)
    if (!extractedPurity && purityMatch) {
      extractedPurity = purityMatch[1].replace(/["']+$/, '').trim()
    }
  }
  if (usedManualFallback && !extractedProduct) {
    extractedProduct = source
  }

  // Determine scanType: manual vs qr vs barcode
  const scanType = isManual
    ? 'manual'
    : getScanTypeFromFormat(format) ?? (source.includes('\n') || source.length > 60 ? 'qr' : 'barcode')

  return {
    raw: raw.trim() || source,
    product: extractedProduct,
    weight: extractedWeight,
    unit: extractedUnit,
    size: extractedSize,
    purity: extractedPurity,
    scanType,
  }
}

export function getItemDisplayName(product: string | undefined, itemNumber: number, scanType?: ScanType) {
  if (product && product.trim()) return product.trim()
  const label = scanType === 'qr' ? 'QR Scanned' : scanType === 'barcode' ? 'Barcode Scanned' : 'Manual Weight'
  return `${label} ${String(itemNumber).padStart(3, '0')}`
}

export function formatWeight(weight: number, unit = 'g') {
  return `${weightInGrams(weight, unit).toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`
}

export function makeSessionNumber(vendor: string, date = new Date()) {
  const dateKey = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const nextSequence = getNextSessionNumber(vendor, date)
  return `BX-${dateKey}-${String(nextSequence).padStart(3, '0')}`
}

export function formatDate(date: Date) {
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`
}

export function getNextItemNumber(items: Pick<Item, 'itemNumber'>[]) {
  return items.length + 1
}
