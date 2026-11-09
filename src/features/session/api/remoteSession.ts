import type { Session } from '../../../types'
import { supabase } from '../../../services/supabaseClient'
import { z } from 'zod'
import { renumberItems } from '../../../utils/items'

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
  weight: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite().positive()),
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

  const { data: itemRows, error: itemError } = await database
    .from('scan_items')
    .select('id, item_number, raw_payload, product, weight, unit, size, purity, scan_type, scanned_at')
    .eq('session_id', sessionRow.id)
    .order('item_number', { ascending: true })
  if (itemError) throw itemError
  const validatedItems = z.array(remoteItemSchema).safeParse(itemRows ?? [])
  if (!validatedItems.success) throw new Error('The saved cloud session contains invalid item data.')

  return toLocalSession(validatedSession.data, validatedItems.data)
}

export async function saveRemoteSession(session: Session) {
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

  if (session.items.length > 0) {
    const { error: itemError } = await database.from('scan_items').upsert(session.items.map(item => ({
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

  const { data: existingItems, error: existingItemsError } = await database
    .from('scan_items')
    .select('id')
    .eq('session_id', sessionRow.id)
  if (existingItemsError) throw existingItemsError

  const retainedIds = new Set(session.items.map(item => item.id))
  const staleIds = (existingItems ?? []).map(item => item.id).filter(id => !retainedIds.has(id))
  if (staleIds.length > 0) {
    const { error: deleteError } = await database.from('scan_items').delete().in('id', staleIds)
    if (deleteError) throw deleteError
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