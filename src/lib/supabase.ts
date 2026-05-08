import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const configuredSupabaseUrl = supabaseUrl ?? ''

export function maskSupabaseUrl() {
  if (!supabaseUrl) return '未配置'
  try {
    const url = new URL(supabaseUrl)
    return `${url.hostname}`
  } catch {
    return 'URL 格式异常'
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
