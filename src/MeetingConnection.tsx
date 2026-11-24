import { useState } from 'react'
import { authenticatedFetch } from './auth'
type Meeting = { id: string; title: string; start: string; ownerId: string; version?: string; editableBlock?: boolean }
type Client = { id: string; name: string; email: string }
type Deal = { id: string; name: string; pipeline: string; createdTime?: string }
async function api(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(path, init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not connect the meeting.')
  return data
}
function easternDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
const format = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
export default function MeetingConnection({ meeting, booking, onChanged }: { meeting?: Meeting; booking?: { dealId: string; contactId: string; ownerId: string }; onChanged?: () => void }) {
  const [query, setQuery] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState(booking?.contactId || '')
  const [deals, setDeals] = useState<Deal[]>([])
  const [dealId, setDealId] = useState(booking?.dealId || '')
  const [date, setDate] = useState('')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [eventId, setEventId] = useState(meeting?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Connection failed.') } finally { setBusy(false) }
  }
  return <section className="meeting-connection">
    <h3>Connect meeting to deal</h3>
    <p>{booking ? 'After completing the booking above, choose its date and select the confirmed meeting below.' : 'Find the client and choose the deal for this meeting.'} Each deal has one meeting. Evaluation date uses the connected meeting?s start time.</p>
    <fieldset disabled={busy || Boolean(success)}>
      {!booking && <><label>Client email or name<input value={query} onChange={e => setQuery(e.target.value)} /></label><button type="button" disabled={query.trim().length < 2 || busy} onClick={() => run(async () => { const data = await api(`/api/stage/search?${new URLSearchParams({ q: query.trim() })}`); setClients(data.clients); setDeals([]); setClientId(''); setDealId('') })}>Find client</button>
      <label>Client<select value={clientId} onChange={e => { const value = e.target.value; setClientId(value); setDeals([]); setDealId(''); if (value) run(async () => { const data = await api(`/api/stage/clients/${value}`); setDeals(data.deals) }) }}><option value="">Choose client</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name} ? {client.email}</option>)}</select></label>
      <label>Deal<select value={dealId} onChange={e => setDealId(e.target.value)}><option value="">Choose deal</option>{deals.map(deal => <option key={deal.id} value={deal.id}>{deal.name} ? {deal.pipeline}{deal.createdTime ? ` ? Created ${format(deal.createdTime)}` : ''}</option>)}</select></label></>}
      {booking && <><label>Meeting date (Eastern Time)<input type="date" value={date} onChange={e => { setDate(e.target.value); setMeetings([]); setEventId('') }} /></label><button type="button" disabled={!date || busy} onClick={() => run(async () => { const data = await api(`/api/calendar?date=${date}`); setMeetings(data.events.filter((event: Meeting) => event.ownerId === booking.ownerId && !event.editableBlock && easternDate(event.start) === date)) })}>Find booked meeting</button>
      <label>Confirmed meeting<select value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Choose meeting</option>{meetings.map(event => <option key={event.id} value={event.id}>{event.title} ? {format(event.start)} ET</option>)}</select></label></>}
      <button type="button" disabled={!clientId || !dealId || !eventId || busy} onClick={() => run(async () => {
        const selected = meeting || meetings.find(event => event.id === eventId)
        const result = await api(`/api/calendar/meetings/${eventId}/deal`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, contactId: clientId, version: selected?.version }) })
        if (!result.evaluationSaved) {
          setError(result.warning || 'The meeting is connected, but its evaluation date could not be verified in Bigin. Refresh and retry.')
          return
        }
        setSuccess(`Meeting connected. Evaluation date and hour saved under Other Info in Bigin: ${format(result.evaluationTime)} ET.`)
        onChanged?.()
      })}>{busy ? 'Please wait?' : 'Connect meeting'}</button>
    </fieldset>
    {error && <p role="alert" className="block-edit-error">{error}</p>}{success && <p role="status">{success}</p>}
  </section>
}
