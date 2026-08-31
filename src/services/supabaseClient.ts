import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const supabaseConfigSchema = z.object({
  url: z.string().url(),
  anonKey: z.string().min(1),
})

const config = supabaseConfigSchema.safeParse({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})

export const supabaseConfig = config.success ? config.data : null

export const supabase = supabaseConfig
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      db: { schema: 'barcox' },
    })
  : null
