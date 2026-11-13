import { createClient } from '@supabase/supabase-js'

export function publicAuthConfig() {
  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) throw new Error('Configure Supabase sign-in on the server.')
  return { url, publishableKey }
}

export function supabaseAdmin() {
  const { url } = publicAuthConfig()
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error('Configure SUPABASE_SECRET_KEY on the server.')
  return createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function authenticate(authorization, create = createClient) {
  if (!authorization?.startsWith('Bearer ') || authorization.length > 10000) return null
  const { url, publishableKey } = publicAuthConfig()
  const client = create(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.getUser(authorization.slice(7))
  if (error || !data?.user || !data.user.email_confirmed_at) return null
  return data.user
}
