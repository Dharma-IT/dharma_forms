import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getAuthClient } from './auth'
import './ManageTeam.css'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    getAuthClient().then(async client => {
      const { data } = client.auth.onAuthStateChange((_event, value) => { if (active) setSession(value) })
      unsubscribe = () => data.subscription.unsubscribe()
      const result = await client.auth.getSession()
      if (result.error) throw result.error
      if (active) { setSession(result.data.session); setLoading(false) }
    }).catch(error => { if (active) { setError(error.message); setLoading(false) } })
    const requireLogin = () => { setSession(null); setError('Your session expired. Sign in again.') }
    window.addEventListener('auth-required', requireLogin)
    return () => { active = false; unsubscribe(); window.removeEventListener('auth-required', requireLogin) }
  }, [])
  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const client = await getAuthClient()
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      setSession(data.session); setPassword('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not sign in.') }
    finally { setBusy(false) }
  }
  if (loading) return <div className="team-page"><p role="status">Checking your session…</p></div>
  if (!session) return <div className="team-page"><div className="pin-overlay"><section className="pin-dialog auth-dialog"><img className="auth-logo" src="/DHARMA%20-%20LOGO%20(9).png" alt="Dharma Nutrition Clinic" /><span className="team-eyebrow">DHARMA NUTRITION CLINIC</span><h2>Sign in</h2><p>Use your team account to access bookings.</p><form onSubmit={signIn}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p className="team-error" role="alert">{error}</p>}<button className="team-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form><small>Need an account or password reset? Contact your administrator.</small></section></div></div>
  return <><div className="auth-bar"><a className="auth-brand" href="/" aria-label="Dharma Nutrition Clinic home"><img src="/DHARMA%20-%20LOGO%20(9).png" alt="" /><span>Dharma Nutrition Clinic</span></a><nav className="auth-navigation" aria-label="Main navigation">{[
    { href: '/', label: 'Booking page' },
    { href: '/stage', label: 'Stages' },
    { href: '/calendar', label: 'Calendar' },
  ].map(item => <a key={item.href} href={item.href} aria-current={currentPath === item.href ? 'page' : undefined}>{item.label}</a>)}</nav><span className="auth-email">{session.user.email}</span><button onClick={async () => { setBusy(true); try { const client = await getAuthClient(); const { error } = await client.auth.signOut(); if (error) throw error; setSession(null) } catch (error) { window.alert(error instanceof Error ? error.message : 'Could not sign out.') } finally { setBusy(false) } }} disabled={busy}>Sign out</button></div><div key={session.user.id}>{children}</div></>
}
