import { z } from 'zod'
import { MAX_ITEM_WEIGHT, type ParsedItem } from '../../../types'
import { supabase } from '../../../services/supabaseClient'
import { getScanTypeFromFormat } from '../../scanner/services/scanner'

const catalogItemSchema = z.object({
  code: z.string().min(1).max(128),
  product: z.string().max(2048).nullable(),
  weight: z.union([z.number(), z.string()]),
  unit: z.enum(['g', 'kg', 'mg']),
  size: z.string().max(200).nullable(),
  purity: z.string().max(40).nullable(),
})

export async function lookupProductByCode(code: string, format?: string): Promise<ParsedItem | null> {
  if (!supabase) return null

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) return null

  const { data, error } = await supabase
    .schema('barcox')
    .from('product_catalog')
    .select('code, product, weight, unit, size, purity')
    .eq('code_key', code.trim().toLowerCase())
    .maybeSingle()

  if (error) throw new Error(`Supabase catalogue lookup failed: ${error.message}`)
  if (!data) return null

  const result = catalogItemSchema.safeParse(data)
  if (!result.success) throw new Error('The matching catalogue entry has invalid data.')

  const weight = Number(result.data.weight)
  if (!Number.isFinite(weight) || weight <= 0 || weight > MAX_ITEM_WEIGHT) {
    throw new Error('The matching catalogue entry must have a supported positive weight.')
  }

  return {
    raw: code.trim(),
    product: result.data.product?.trim() || result.data.code,
    weight,
    unit: result.data.unit,
    size: result.data.size ?? undefined,
    purity: result.data.purity ?? undefined,
    scanType: getScanTypeFromFormat(format) ?? 'barcode',
  }
}
