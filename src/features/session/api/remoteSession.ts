import { MAX_ITEM_WEIGHT, MAX_SESSION_ITEMS, type Session } from '../../../types'
import { supabase } from '../../../services/supabaseClient'
import { z } from 'zod'
import { renumberItems } from '../../../utils/items'

const REMOTE_PAGE_SIZE = 1000
const REMOTE_WRITE_BATCH_SIZE = 100

const remoteSessionSchema = z.object({
  id: z.string().min(1),
  session_number: z.string().max(40),
  business_name: z.string().min(1).max(120),
  product_name: z.string().max(120).nullable(),
  status: z.enum(['active', 'paused', 'completed']),
  started_at: z.string().datetime(),
})
const remoteItemSchema = z.object({
  id: z.string().min(1).max(100),
  item_number: z.number().int().positive(),
  raw_payload: z.string().min(1).max(2048),
  product: z.string().max(2048).nullable(),
  weight: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite().positive().max(MAX_ITEM_WEIGHT)),
  unit: z.enum(['g', 'kg', 'mg']),
  size: z.string().max(200).nullable(),
  purity: z.string().max(40).nullable(),
  scan_type: z.enum(['qr', 'barcode', 'manual']),
  scanned_at: z.string().datetime(),
})

export async function loadRemoteSession(): Promise<Session | null> {
  if (!supabase) return null
  const database = supabase.schema('barcox')
  const { data: sessionRow, error: sessionError } = await database
    .from('scan_sessions')
    .select('id, session_number, business_name, product_name, status, started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sessionError) throw sessionError
  if (!sessionRow) return null
  const validatedSession = remoteSessionSchema.safeParse(sessionRow)
  if (!validatedSession.success) throw new Error('The saved cloud session contains invalid data.')

  const itemRows: unknown[] = []
  for (let from = 0; ; from += REMOTE_PAGE_SIZE) {
    const { data, error } = await database
      .from('scan_items')
      .select('id, item_number, raw_payload, product, weight, unit, size, purity, scan_type, scanned_at')
      .eq('session_id', sessionRow.id)
      .order('item_number', { ascending: true })
      .range(from, from + REMOTE_PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    itemRows.push(...page)
    if (page.length < REMOTE_PAGE_SIZE) break
  }
  const validatedItems = z.array(remoteItemSchema).max(MAX_SESSION_ITEMS).safeParse(itemRows)
  if (!validatedItems.success) throw new Error('The saved cloud session contains invalid item data.')

  return toLocalSession(validatedSession.data, validatedItems.data)
}

export async function saveRemoteSession(session: Session, previousSession?: Session | null) {
  if (!supabase || !session.number || !session.business) return
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) return

  const database = supabase.schema('barcox')
  const { data: sessionRow, error: sessionError } = await database
    .from('scan_sessions')
    .upsert({
      session_number: session.number,
      business_name: session.business,
      product_name: session.productName?.trim() || null,
      status: session.status,
      owner_id: userData.user.id,
      completed_at: session.status === 'completed' ? new Date().toISOString() : null,
    }, { onConflict: 'owner_id,session_number' })
    .select('id')
    .single()
  if (sessionError) throw sessionError

  const baseline = previousSession?.number === session.number
    ? previousSession
    : previousSession === undefined ? undefined : null
  const currentIds = new Set(session.items.map(item => item.id))
  const previousItemsById = new Map(baseline?.items.map(item => [item.id, item]) ?? [])
  const changedItems = baseline
    ? session.items.filter(item => {
      const previous = previousItemsById.get(item.id)
      return !previous ||
        previous.itemNumber !== item.itemNumber ||
        previous.raw !== item.raw ||
        previous.product !== item.product ||
        previous.weight !== item.weight ||
        previous.unit !== item.unit ||
        previous.size !== item.size ||
        previous.purity !== item.purity ||
        previous.scanType !== item.scanType ||
        previous.scannedAt !== item.scannedAt
    })
    : session.items

  let staleIds: string[]
  if (baseline) {
    staleIds = baseline.items.filter(item => !currentIds.has(item.id)).map(item => item.id)
  } else if (previousSession === null || (previousSession !== undefined && previousSession.number !== session.number)) {
    staleIds = []
  } else {
    const existingItems: { id: string }[] = []
    for (let from = 0; ; from += REMOTE_PAGE_SIZE) {
      const { data, error } = await database
        .from('scan_items')
        .select('id')
        .eq('session_id', sessionRow.id)
        .range(from, from + REMOTE_PAGE_SIZE - 1)
      if (error) throw error
      const page = data ?? []
      existingItems.push(...page)
      if (page.length < REMOTE_PAGE_SIZE) break
    }
    staleIds = existingItems.filter(item => !currentIds.has(item.id)).map(item => item.id)
  }

  for (let from = 0; from < staleIds.length; from += REMOTE_WRITE_BATCH_SIZE) {
    const { error } = await database.from('scan_items').delete().in('id', staleIds.slice(from, from + REMOTE_WRITE_BATCH_SIZE))
    if (error) throw error
  }

  for (let from = 0; from < changedItems.length; from += REMOTE_WRITE_BATCH_SIZE) {
    const batch = changedItems.slice(from, from + REMOTE_WRITE_BATCH_SIZE)
    const { error: itemError } = await database.from('scan_items').upsert(batch.map(item => ({
        id: item.id,
        session_id: sessionRow.id,
        item_number: item.itemNumber,
        raw_payload: item.raw,
        product: item.product ?? null,
        weight: item.weight,
        unit: item.unit,
        size: item.size ?? null,
        purity: item.purity ?? null,
        scan_type: item.scanType ?? (item.product ? 'qr' : 'manual'),
        scanned_at: item.scannedAt,
    })), { onConflict: 'id' })
    if (itemError) throw itemError
  }
}

function toLocalSession(sessionRow: z.infer<typeof remoteSessionSchema>, itemRows: z.infer<typeof remoteItemSchema>[]): Session {
  return {
    business: sessionRow.business_name,
    productName: sessionRow.product_name ?? undefined,
    number: sessionRow.session_number,
    status: sessionRow.status,
    items: renumberItems(itemRows.map(item => ({
      id: item.id,
      itemNumber: item.item_number,
      raw: item.raw_payload,
      product: item.product ?? undefined,
      weight: item.weight,
      unit: item.unit,
      size: item.size ?? undefined,
      purity: item.purity ?? undefined,
      scanType: item.scan_type,
      scannedAt: item.scanned_at,
    }))),
  }
}