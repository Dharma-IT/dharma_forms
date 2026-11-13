import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
let clientPromise: Promise<SupabaseClient> | undefined
export function getAuthClient() {
  clientPromise ||= (async () => {
    const response = await fetch('/api/auth/config')
    const config = await response.json()
    if (!response.ok) throw new Error(config.error || 'Sign-in is unavailable.')
    return createClient(config.url, config.publishableKey)
  })().catch(error => { clientPromise = undefined; throw error })
  return clientPromise
}
export async function authenticatedFetch(input: string, init: RequestInit = {}) {
  const client = await getAuthClient()
  const { data, error } = await client.auth.getSession()
  if (error || !data.session) { window.dispatchEvent(new Event('auth-required')); throw new Error('Your session expired. Sign in again.') }
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${data.session.access_token}`)
  const response = await fetch(input, { ...init, headers })
  if (response.status === 401 && !input.startsWith('/api/manage-team')) window.dispatchEvent(new Event('auth-required'))
  return response
}
