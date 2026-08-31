import type { Session } from '../types'
import { supabase } from './supabaseClient'

type RemoteSessionRow = {
  id: string
  session_number: string
  business_name: string
  status: Session['status']
  started_at: string
}

type RemoteItemRow = {
  id: string
  item_number: number
  raw_payload: string
  product: string | null
  weight: number | string
  unit: string
  size: string | null
  scan_type: 'qr' | 'manual'
  scanned_at: string
}

export async function loadRemoteSession(): Promise<Session | null> {
  if (!supabase) return null
  const database = supabase.schema('barcox')
  const { data: sessionRow, error: sessionError } = await database
    .from('scan_sessions')
    .select('id, session_number, business_name, status, started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sessionError || !sessionRow) return null

  const { data: itemRows, error: itemError } = await database
    .from('scan_items')
    .select('id, item_number, raw_payload, product, weight, unit, size, scan_type, scanned_at')
    .eq('session_id', sessionRow.id)
    .order('item_number', { ascending: true })
  if (itemError) throw itemError

  return toLocalSession(sessionRow as RemoteSessionRow, (itemRows ?? []) as RemoteItemRow[])
}

export async function saveRemoteSession(session: Session) {
  if (!supabase || !session.number || !session.business) return
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return

  const database = supabase.schema('barcox')
  const { data: sessionRow, error: sessionError } = await database
    .from('scan_sessions')
    .upsert({
      session_number: session.number,
      business_name: session.business,
      status: session.status,
      owner_id: userData.user.id,
      completed_at: session.status === 'completed' ? new Date().toISOString() : null,
    }, { onConflict: 'session_number' })
    .select('id')
    .single()
  if (sessionError) throw sessionError

  const { error: deleteError } = await database.from('scan_items').delete().eq('session_id', sessionRow.id)
  if (deleteError) throw deleteError
  if (session.items.length === 0) return

  const { error: itemError } = await database.from('scan_items').insert(session.items.map(item => ({
    id: item.id,
    session_id: sessionRow.id,
    item_number: item.itemNumber,
    raw_payload: item.raw,
    product: item.product ?? null,
    weight: item.weight,
    unit: item.unit,
    size: item.size ?? null,
    scan_type: item.scanType ?? (item.product ? 'qr' : 'manual'),
    scanned_at: item.scannedAt,
  })))
  if (itemError) throw itemError
}

function toLocalSession(sessionRow: RemoteSessionRow, itemRows: RemoteItemRow[]): Session {
  return {
    business: sessionRow.business_name,
    number: sessionRow.session_number,
    status: sessionRow.status,
    items: itemRows.map(item => ({
      id: item.id,
      itemNumber: item.item_number,
      raw: item.raw_payload,
      product: item.product ?? undefined,
      weight: Number(item.weight),
      unit: item.unit,
      size: item.size ?? undefined,
      scanType: item.scan_type,
      scannedAt: item.scanned_at,
    })),
  }
}