import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
})

// V2: Real Supabase Auth functions

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  // Store token in cookie for middleware
  if (typeof document !== 'undefined' && data.session) {
    document.cookie = `sb-access-token=${data.session.access_token}; path=/; SameSite=Lax; max-age=${60 * 60 * 24 * 7}`
  }
  return data.session
}

export async function signOut() {
  await supabase.auth.signOut()
  if (typeof document !== 'undefined') {
    document.cookie = 'sb-access-token=; path=/; max-age=0'
  }
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
