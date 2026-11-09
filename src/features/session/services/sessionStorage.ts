import { EMPTY_SESSION, type Session } from '../../../types'
import { z } from 'zod'
import { renumberItems } from '../../../utils/items'

const itemSchema = z.object({
  id: z.string().min(1).max(100),
  itemNumber: z.number().int().positive(),
  raw: z.string().min(1).max(2048),
  product: z.string().max(2048).optional(),
  weight: z.number().finite().positive(),
  unit: z.string().min(1).max(12),
  size: z.string().max(200).optional(),
  purity: z.string().max(40).optional(),
  scannedAt: z.string().datetime(),
  scanType: z.enum(['qr', 'barcode', 'manual']).optional(),
})

const sessionSchema = z.object({
  business: z.string().trim().min(1).max(120),
  productName: z.string().trim().max(120).optional(),
  number: z.string().max(40),
  items: z.array(itemSchema).max(10000),
  status: z.enum(['active', 'paused', 'completed']),
  updatedAt: z.string().datetime().optional(),
})
const sessionSequenceSchema = z.record(z.string(), z.record(z.string(), z.number().int().nonnegative()))

const SESSION_KEY = 'barcox-session'
const SESSION_SEQUENCE_KEY = 'barcox-session-sequence'

type SessionSequenceIndex = Record<string, Record<string, number>>

export function loadSession(): Session {
  const saved = localStorage.getItem(SESSION_KEY)
  if (!saved) return EMPTY_SESSION
  try {
    const result = sessionSchema.safeParse(JSON.parse(saved))
    if (!result.success) {
      localStorage.removeItem(SESSION_KEY)
      return EMPTY_SESSION
    }
    return { ...result.data, items: renumberItems(result.data.items) }
  } catch {
    localStorage.removeItem(SESSION_KEY)
    return EMPTY_SESSION
  }
}

export function saveSession(session: Session) {
  const result = sessionSchema.safeParse(session)
  if (result.success) localStorage.setItem(SESSION_KEY, JSON.stringify(result.data))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function loadSessionSequence(): SessionSequenceIndex {
  const saved = localStorage.getItem(SESSION_SEQUENCE_KEY)
  if (!saved) return {}

  try {
    const parsed = sessionSequenceSchema.safeParse(JSON.parse(saved))
    if (!parsed.success) {
      localStorage.removeItem(SESSION_SEQUENCE_KEY)
      return {}
    }
    return parsed.data
  } catch {
    localStorage.removeItem(SESSION_SEQUENCE_KEY)
    return {}
  }
}

export function saveSessionSequence(sequence: SessionSequenceIndex) {
  localStorage.setItem(SESSION_SEQUENCE_KEY, JSON.stringify(sequence))
}

export function getNextSessionNumber(vendor: string, date = new Date()): number {
  const safeVendor = vendor.trim() || 'General'
  const dateKey = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const sequence = loadSessionSequence()
  const vendorMap = sequence[dateKey] ?? {}
  const current = vendorMap[safeVendor] ?? 0
  const next = current + 1
  sequence[dateKey] = { ...vendorMap, [safeVendor]: next }
  saveSessionSequence(sequence)
  return next
}
