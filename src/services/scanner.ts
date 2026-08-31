import { getNextSessionNumber } from './sessionStorage'
import type { Item, ParsedItem, ScanType } from '../types'

/**
 * Normalizes weight unit string to standard abbreviation (default 'g').
 */
function normalizeUnit(unitRaw?: string): string {
  if (!unitRaw) return 'g'
  const u = unitRaw.trim().toLowerCase()
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(u)) return 'g'
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(u)) return 'kg'
  if (['mg', 'mgs', 'milligram'].includes(u)) return 'mg'
  return u || 'g'
}

/**
 * Parses raw barcode / QR / manual weight input.
 * Supports:
 *  - Plain numeric weights ("56.6", "56.60g", "56.60 gm", "42.500")
 *  - Keyed weight formats ("Net Weight: 56.6g", "NW: 56.6", "N.W: 56.6", "WT: 56.6", "Net Wt: 56.6", "W: 56.6", "GW: 58.2")
 *  - Delimited barcode tags ("PAYAL | 56.60g | Size: 10", "ITEM-01, 25.50, 8", "TAG-99/12.45G")
 *  - Multi-line QR payloads (Product, Net Weight, Size)
 *  - GS1 AI weight barcodes (e.g. "(3102)005660" -> 56.60g)
 */
export function parseQr(raw: string, manualWeight: string, format?: string): ParsedItem | { error: string } {
  if (raw.length > 2048 || manualWeight.length > 32) return { error: 'Input is too long.' }
  const source = raw.trim() || manualWeight.trim()
  if (!source) return { error: 'Enter a QR payload, barcode data, or a manual weight.' }

  const isManual = !raw.trim() && Boolean(manualWeight.trim())

  let extractedWeight: number | null = null
  let extractedUnit = 'g'
  let extractedProduct: string | undefined
  let extractedSize: string | undefined

  // 1. Check for GS1 Barcode format e.g. (3102)005660 or 3102005660 (AI 3102 = net weight with 2 decimal places -> e.g. 56.60)
  const gs1Match = source.match(/\(?310([0-5])\)?\s*([0-9]{6})/i)
  if (gs1Match) {
    const decimals = Number(gs1Match[1])
    const rawVal = Number(gs1Match[2]) / Math.pow(10, decimals)
    extractedWeight = Math.round(rawVal * 1000) / 1000
    extractedUnit = 'g'
  }

  // 2. Check for explicit tagged weights (e.g. Net Weight: 56.6, NW: 56.6g, N.W.: 56.6, WT: 56.6, W: 56.6, Gross Wt: 58.2)
  if (extractedWeight === null) {
    const taggedMatch = source.match(/(?:net\s*weight|net\s*wt\.?|netwt\.?|n\.?w\.?|weight|gross\s*weight|gross\s*wt\.?|g\.?w\.?|wt\.?|w)\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?/i)
    if (taggedMatch) {
      extractedWeight = Number(taggedMatch[1])
      extractedUnit = normalizeUnit(taggedMatch[2])
    }
  }

  // 3. Check for plain number / number with unit (e.g. "42.5", "56.60g", "12.45 gm")
  if (extractedWeight === null) {
    const plainMatch = source.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?\s*$/)
    if (plainMatch) {
      extractedWeight = Number(plainMatch[1])
      extractedUnit = normalizeUnit(plainMatch[2])
    }
  }

  // 4. Check for delimited weight token inside barcode strings (e.g. "ITEM-01 | 56.60g | 10" or "PAYAL/56.60/10")
  if (extractedWeight === null) {
    const delimitedMatch = source.match(/(?:^|[|,;/-\s])\s*([0-9]+(?:\.[0-9]+)?)\s*(g|gm|gms|gram|grams|mg|kg)?\s*(?=[|,;/-\s]|$)/i)
    if (delimitedMatch) {
      extractedWeight = Number(delimitedMatch[1])
      extractedUnit = normalizeUnit(delimitedMatch[2])
    }
  }

  // If no valid weight found
  if (extractedWeight === null || !Number.isFinite(extractedWeight)) {
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
  const isSimpleWeight = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?\s*$/.test(source)
  if (!isSimpleWeight && !isManual) {
    // Multi-line QR: first line is often the product description
    const lines = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length > 1) {
      // First line if it's not a weight header
      if (!/^(?:net\s*weight|weight|nw|wt)/i.test(lines[0])) {
        extractedProduct = lines[0]
      }
    } else if (source.includes('|') || source.includes('/') || source.includes(';')) {
      // Delimited format: take the first non-weight segment as product name
      const parts = source.split(/[|/;]/).map(p => p.trim()).filter(Boolean)
      const nonWeightPart = parts.find(p => !/(?:weight|nw|wt|\d+\.?\d*\s*g)/i.test(p))
      if (nonWeightPart) extractedProduct = nonWeightPart
    } else {
      const firstPart = source.match(/^(.*?)(?:\s*(?:net\s*weight|nw|wt|weight|size|\n|$))/i)?.[1]?.trim()
      if (firstPart && !/^[0-9.]+$/.test(firstPart)) {
        extractedProduct = firstPart
      }
    }

    // Size extraction
    const sizeMatch = source.match(/size\s*[:=-]?\s*([^\r\n,;|"]+)/i)
    if (sizeMatch) {
      extractedSize = sizeMatch[1].replace(/["']$/, '').trim()
    }
  }

  // Determine scanType: manual vs qr vs barcode
  let scanType: ScanType = 'manual'
  if (!isManual) {
    // If format is provided, use it to determine type
    if (format) {
      const formatUpper = format.toUpperCase()
      scanType = formatUpper.includes('QR') ? 'qr' : 'barcode'
    } else {
      // Fallback: infer from content
      scanType = source.includes('\n') || source.length > 60 ? 'qr' : 'barcode'
    }
  }

  return {
    raw: source,
    product: extractedProduct,
    weight: extractedWeight,
    unit: extractedUnit,
    size: extractedSize,
    scanType,
  }
}

export function findDuplicateItem(items: Item[], raw: string) {
  return items.find(item => item.raw.trim().toLowerCase() === raw.trim().toLowerCase())
}

export function getItemDisplayName(product: string | undefined, itemNumber: number, scanType?: ScanType) {
  if (product && product.trim()) return product.trim()
  const label = scanType === 'qr' ? 'QR Scanned' : scanType === 'barcode' ? 'Barcode Scanned' : 'Manual Weight'
  return `${label} ${String(itemNumber).padStart(3, '0')}`
}

export function formatWeight(weight: number) {
  return `${weight.toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`
}

export function makeSessionNumber(vendor: string, date = new Date()) {
  const dateKey = date.toISOString().slice(0, 10).replaceAll('-', '')
  const nextSequence = getNextSessionNumber(vendor, date)
  return `BX-${dateKey}-${String(nextSequence).padStart(3, '0')}`
}

export function formatDate(date: Date) {
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`
}
