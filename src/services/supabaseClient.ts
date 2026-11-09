import { createClient } from '@supabase/supabase-js'
import { supabaseConfig } from '../config/env'

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
