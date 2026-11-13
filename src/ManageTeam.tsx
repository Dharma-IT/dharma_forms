import { useState } from 'react'
import type { FormEvent } from 'react'
import './ManageTeam.css'
import { authenticatedFetch as fetch } from './auth'

type Member = { team: string; id: string; name: string; bookingUrl: string }
type User = { id: string; name: string; email: string }
const teams = [{ id: 'agents', name: 'Booking agents' }, { id: 'nutritionists', name: 'Nutritionists' }, { id: 'sellers', name: 'Sellers' }, { id: 'customer-service', name: 'Customer Service' }]

export default function ManageTeam() {
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [team, setTeam] = useState('nutritionists')
  const [userId, setUserId] = useState('')
  const [url, setUrl] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function api(path: string, method = 'GET', body?: object) {
    const response = await fetch(`/api/manage-team${path}`, { method, headers: { 'X-Management-Pin': pin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const data = await response.json()
    if (response.status === 401) setUnlocked(false)
    if (!response.ok) throw new Error(data.error || 'Request failed. Please retry.')
    return data
  }
  async function loadUsers() {
    const data = await api('/users')
    setUsers(data.users)
  }
  async function unlock(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const data = await api('')
      setMembers(data.members); setUnlocked(true)
      await loadUsers()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open team settings.') }
    finally { setBusy(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const data = await api('', 'PUT', { team, id: userId, bookingUrl: url })
      setMembers(data.members); setUserId(''); setUrl(''); setNotice('Team member saved. The booking form will use these settings when opened or refreshed.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save member.') }
    finally { setBusy(false) }
  }
  async function remove(member: Member) {
    if (!window.confirm(`Remove ${member.name} from this team?`)) return
    setBusy(true); setError(''); setNotice('')
    try { const data = await api('', 'DELETE', member); setMembers(data.members); setNotice('Team member removed.') }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not remove member.') }
    finally { setBusy(false) }
  }
  const current = members.filter(member => member.team === team)
  return <div className="team-page">
    <main className={`team-content ${unlocked ? '' : 'team-locked'}`} inert={!unlocked} aria-hidden={!unlocked}>
      <header className="team-header"><div><span className="team-eyebrow">DHARMA NUTRITION CLINIC</span><h1>Manage team</h1><p>Keep your people and booking calendars up to date.</p></div><button onClick={() => { setUnlocked(false); setPin(''); setMembers([]); setUsers([]); setError(''); setNotice('') }}>Lock page</button></header>
      {unlocked && <>
        {error && <p role="alert" className="team-error">{error}</p>}
        {notice && <p role="status" className="team-notice">{notice}</p>}
        <div className="team-tabs" role="group" aria-label="Select team">{teams.map(item => <button key={item.id} aria-pressed={team === item.id} onClick={() => { setTeam(item.id); setUserId(''); setUrl(''); setNotice('') }}>{item.name}</button>)}</div>
        <div className="team-columns"><section className="team-card"><h2>{teams.find(item => item.id === team)?.name}</h2><p>{current.length} assigned {current.length === 1 ? 'member' : 'members'}</p>
          {!current.length && <p>No members yet. Add a verified Bigin user to get started.</p>}
          {current.map(member => <article className="team-member" key={member.id}><h3>{member.name}</h3><p>{member.bookingUrl ? <a href={member.bookingUrl} target="_blank" rel="noreferrer">Open calendar ↗</a> : 'No calendar link'}</p><div><button disabled={busy} onClick={() => { setUserId(member.id); setUrl(member.bookingUrl); setSearch(''); setNotice('Editing member. Save below to apply changes.') }}>Edit</button><button disabled={busy} onClick={() => remove(member)}>Remove</button></div></article>)}
        </section><section className="team-card"><h2>Add or update a member</h2><p>Only active, confirmed accounts found in Bigin can be added. This does not create or change a Bigin account.</p>
          <form onSubmit={save}><fieldset disabled={busy}>
            <label>Find a Bigin user<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email" /></label>
            <label>Bigin account<select required value={userId} onChange={e => { setUserId(e.target.value); setUrl(current.find(member => member.id === e.target.value)?.bookingUrl || '') }}><option value="">Select a verified account</option>{users.filter(user => user.id === userId || `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase())).map(user => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
            <label>Calendar link {team === 'agents' ? '(optional)' : ''}<input type="url" required={team !== 'agents'} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label><small>Use a public HTTPS booking page that allows embedding. Some calendar providers may block embedding.</small>
            <button className="team-primary" type="submit" disabled={!users.length}>{busy ? 'Saving…' : 'Save member'}</button>
          </fieldset></form>
          <button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await loadUsers(); setNotice('Bigin user list refreshed.') } catch (error) { setError(error instanceof Error ? error.message : 'Could not load users.') } finally { setBusy(false) } }}>Refresh Bigin users</button>
        </section></div>
      </>}
      {!unlocked && <div className="team-placeholder"><div /><div /><div /></div>}
    </main>
    {!unlocked && <div className="pin-overlay"><section className="pin-dialog" role="dialog" aria-modal="true" aria-labelledby="pin-title"><span className="team-eyebrow">TEAM SETTINGS</span><h2 id="pin-title">Enter your PIN</h2><p>Unlock team members and calendar settings.</p><form onSubmit={unlock}><label htmlFor="management-pin">Management PIN</label><input autoFocus id="management-pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" minLength={4} maxLength={12} required autoComplete="off" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />{error && <p role="alert" className="team-error">{error}</p>}<button className="team-primary" disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button></form><a href="/">Back to booking</a></section></div>}
  </div>
}
