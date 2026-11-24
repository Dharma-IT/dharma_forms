import { useEffect, useRef, useState } from 'react'
import { authenticatedFetch } from './auth'
import './Calendar.css'
import MeetingConnection from './MeetingConnection'
import CalendarBlockEditor from './CalendarBlockEditor'

type Person = { id: string; name: string; email: string; teams: string[] }
type CalendarEvent = { id: string; title: string; start: string; end: string; ownerId: string; allDay: boolean; editableBlock?: boolean; location?: string; description?: string; relatedTo?: string; relatedId?: string; relatedModule?: string; version?: string; participants?: { name: string; email: string; status: string }[] }
const teamLabels: Record<string, string> = { sellers: 'Seller', 'customer-service': 'Customer Service', nutritionists: 'Nutri' }
function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="4" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></svg>
}
const hourHeight = 120
const zone = 'America/New_York'
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
function dateKey(value: Date) {
  const parts = dayFormat.formatToParts(value)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
function minute(value: string, day: string) {
  const date = new Date(value)
  const key = dateKey(date)
  if (key < day) return 0
  if (key > day) return 1440
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  return Number(parts.find(part => part.type === 'hour')?.value) * 60 + Number(parts.find(part => part.type === 'minute')?.value)
}
function EventDetails({ event, owner, onClose, onChanged }: { event: CalendarEvent; owner?: Person; onClose: () => void; onChanged: () => void }) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  async function cancelMeeting() {
    setCancelling(true); setCancelError('')
    try {
      const response = await authenticatedFetch(`/api/calendar/meetings/${event.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: event.version, ownerId: event.ownerId }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not cancel this meeting.')
      onChanged()
    } catch (reason) { setCancelError(reason instanceof Error ? reason.message : 'Could not cancel this meeting.') }
    finally { setCancelling(false) }
  }
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' })
  return <dialog ref={dialog} className="event-dialog" onCancel={onClose} onClick={click => { if (click.target === click.currentTarget) onClose() }}>
    <article>
      <button className="event-close" type="button" onClick={onClose} autoFocus>Close</button>
      <h2>{event.title}</h2>
      <dl>
        <dt>Meeting with</dt><dd>{owner?.name}<br />{owner?.email}</dd>
        <dt>When</dt><dd>{event.allDay && <>All day<br /></>}{format.format(new Date(event.start))}<br />to {format.format(new Date(event.end))}<br />Eastern Time (America/New_York)</dd>
        <dt>Location</dt><dd>{event.location || 'No location provided'}</dd>
        <dt>Related record</dt><dd>{event.relatedTo || 'No linked record in Bigin'}{event.relatedId && <small className="event-related-id">{event.relatedModule} ? {event.relatedId}</small>}</dd>
        <dt>Description</dt><dd className="event-description">{event.editableBlock ? 'This block makes overlapping appointment times unavailable.' : event.description || 'No description provided'}</dd>
        <dt>Participants</dt><dd>{event.participants?.length ? <ul>{event.participants.map((person, index) => <li key={index}>{person.name}{person.email && <div>{person.email}</div>}{person.status && <small>{person.status}</small>}</li>)}</ul> : 'No participants listed'}</dd>
      </dl>
      {!event.editableBlock && <MeetingConnection meeting={event} onChanged={onChanged} />}
      {!event.editableBlock && <section className="meeting-cancel">
        {confirmCancel ? <><p>Cancel this meeting? This removes the meeting from Bigin. The deal remains unchanged. Attendee notifications are not guaranteed; notify the client separately.</p><div className="block-edit-actions"><button type="button" disabled={cancelling} onClick={cancelMeeting}>{cancelling ? 'Cancelling?' : 'Confirm cancellation'}</button><button type="button" disabled={cancelling} onClick={() => setConfirmCancel(false)}>Keep meeting</button></div></> : <button type="button" className="cancel-meeting-button" onClick={() => setConfirmCancel(true)}>Cancel meeting</button>}
        {cancelError && <p role="alert" className="block-edit-error">{cancelError}</p>}
      </section>}
      {event.editableBlock && owner && <CalendarBlockEditor block={event} teams={owner.teams} onChanged={onChanged} />}
    </article>
  </dialog>
}
export default function Calendar() {
  const [date, setDate] = useState(() => dateKey(new Date()))
  const [data, setData] = useState<{ people: Person[]; events: CalendarEvent[] }>({ people: [], events: [] })
  const [team, setTeam] = useState('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    authenticatedFetch(`/api/calendar?date=${date}`, { signal: controller.signal }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(response.status === 404 ? 'Calendar service is unavailable. Deploy the latest backend update on Render, then refresh.' : result.error || 'Could not load calendar.')
      if (!controller.signal.aborted) setData(result)
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [date, revision])
  function selectDate(value: string) {
    setLoading(true)
    setError('')
    setSelected(null)
    setDate(value)
    setRevision(current => current + 1)
  }
  function changeDay(amount: number) {
    const next = new Date(`${date}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + amount)
    selectDate(next.toISOString().slice(0, 10))
  }
  const people = data.people.filter(person => team === 'all' || (team === 'sellers-cs' ? person.teams.some(value => ['sellers', 'customer-service'].includes(value)) : person.teams.includes(team)))
  const events = data.events.filter(event => minute(event.end, date) > 0 && minute(event.start, date) < 1440)
  return <main className="team-calendar"><div className="calendar-ambient calendar-ambient-one" aria-hidden="true" /><div className="calendar-ambient calendar-ambient-two" aria-hidden="true" />
    <header className="calendar-toolbar"><div className="calendar-heading"><a href="/">&#8592; Booking workspace</a><div className="calendar-title-row"><span className="calendar-title-icon"><CalendarIcon /></span><div><span className="calendar-eyebrow">PEOPLE &amp; APPOINTMENTS</span><h1>Team calendar<span>.</span></h1></div></div></div><button onClick={() => selectDate(dateKey(new Date()))}>Today</button><button aria-label="Previous day" onClick={() => changeDay(-1)}><span aria-hidden="true">&#8592;</span> Previous</button><label>Date<input type="date" value={date} onChange={event => { if (event.target.value) selectDate(event.target.value) }} /></label><button aria-label="Next day" onClick={() => changeDay(1)}>Next <span aria-hidden="true">&#8594;</span></button><label>Team<select value={team} onChange={event => setTeam(event.target.value)}><option value="all">All Teams</option><option value="sellers-cs">Sellers & Customer Service</option><option value="sellers">Sellers</option><option value="customer-service">Customer Service</option><option value="nutritionists">Nutri</option></select></label><button onClick={() => selectDate(date)} disabled={loading}><span className={loading ? 'calendar-refresh-icon is-spinning' : 'calendar-refresh-icon'} aria-hidden="true">&#8635;</span> Refresh</button></header>
    <div className="calendar-context"><div className="calendar-date-caption"><strong>{new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`))}</strong><span className="calendar-zone">Eastern Time &middot; New York</span></div><div className="calendar-legend" aria-label="Team colors"><span className="legend-seller">Sellers</span><span className="legend-cs">Customer Service</span><span className="legend-nutri">Nutritionists</span></div><span className="calendar-people-count">{people.length} team members</span></div>
    {loading ? <p role="status">Loading schedules...</p> : error ? <p role="alert">{error}</p> : people.length === 0 ? <p>No team members configured for this team.</p> : <div className="calendar-scroll"><div className="calendar-grid" style={{ gridTemplateColumns: `72px repeat(${people.length}, minmax(260px, 1fr))` }}>
      <div className="calendar-person time-heading">Time</div>{people.map(person => <div className="calendar-person" key={person.id}><div className="calendar-person-heading"><span className={`calendar-person-avatar ${person.teams.includes('sellers') ? 'avatar-seller' : person.teams.includes('customer-service') ? 'avatar-cs' : 'avatar-nutri'}`} aria-hidden="true">{person.name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('')}</span><strong>{person.name}</strong></div><span>{person.email || 'Email unavailable'}</span><small>{person.teams.map(value => teamLabels[value] || value).join(' / ')}</small></div>)}
      <div className="calendar-hours" style={{ height: 24 * hourHeight }}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * hourHeight }}>{hour % 12 || 12} {hour < 12 ? 'AM' : 'PM'}</span>)}</div>
      {people.map(person => {
        const ownEvents = events.filter(event => event.ownerId === person.id).sort((a, b) => minute(a.start, date) - minute(b.start, date))
        const groups: CalendarEvent[][] = []
        for (const event of ownEvents) {
          const group = groups[groups.length - 1]
          if (group && group.some(other => minute(other.end, date) > minute(event.start, date))) group.push(event)
          else groups.push([event])
        }
        return <div className="calendar-day" style={{ height: 24 * hourHeight }} key={person.id}>{groups.flatMap(group => group.map((event, index) => <button key={event.id} className={`calendar-event ${(minute(event.end, date) - minute(event.start, date)) < 25 ? 'calendar-event-short' : ''} ${/out of office/i.test(event.title) ? 'calendar-unavailable' : ''} ${team === 'nutritionists' ? 'nutri-event' : team === 'customer-service' ? 'cs-event' : person.teams.includes('sellers') ? 'seller-event' : person.teams.includes('customer-service') ? 'cs-event' : 'nutri-event'}`} style={{ top: minute(event.start, date) * hourHeight / 60, height: Math.max(28, (minute(event.end, date) - minute(event.start, date)) * hourHeight / 60), left: `${index * 100 / group.length}%`, width: `${100 / group.length}%` }} onClick={() => setSelected(event)} title={`${event.title}\n${timeFormat.format(new Date(event.start))} - ${timeFormat.format(new Date(event.end))}`}><strong>{event.title}</strong><span>{event.allDay ? 'All day' : `${timeFormat.format(new Date(event.start))} - ${timeFormat.format(new Date(event.end))}`}</span></button>))}</div>
      })}
    </div></div>}
    {selected && <EventDetails key={selected.id} event={selected} owner={data.people.find(person => person.id === selected.ownerId)} onClose={() => setSelected(null)} onChanged={() => selectDate(date)} />}
  </main>
}

