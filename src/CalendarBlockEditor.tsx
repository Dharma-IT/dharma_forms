import { useState } from 'react'
import type { FormEvent } from 'react'
import { authenticatedFetch } from './auth'

type Block = { id: string; ownerId: string; start: string; end: string }
const localFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export default function CalendarBlockEditor({ block, teams, onChanged }: { block: Block; teams: string[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(() => localFormat.format(new Date(block.start)).replace(' ', 'T'))
  const [end, setEnd] = useState(() => localFormat.format(new Date(block.end)).replace(' ', 'T'))
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function change(remove: boolean) {
    if (busy) return
    if (!/^\d{4,12}$/.test(pin)) { setError('Enter your management PIN to change calendar blocks.'); return }
    if (remove && !window.confirm('Remove this block for this date and reopen its appointment times?')) return
    setBusy(true); setError('')
    try {
      const response = await authenticatedFetch('/api/manage-team/calendar-blocks', {
        method: remove ? 'DELETE' : 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Management-Pin': pin },
        body: JSON.stringify({ id: block.id, ownerId: block.ownerId, team: teams.find(team => ['sellers', 'customer-service', 'nutritionists'].includes(team)), mode: 'times', start, end, expectedStart: block.start, expectedEnd: block.end }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not change this block.')
      setPin(''); onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change this block.') }
    finally { setBusy(false) }
  }
  function save(event: FormEvent) { event.preventDefault(); void change(false) }
  if (!open) return <button className="block-edit-button" type="button" onClick={() => setOpen(true)}>Edit or remove block</button>
  return <section className="calendar-block-form" aria-label="Edit calendar block">
    <h3>Edit this block</h3>
    <p>Times use Eastern Time (America/New_York). Changes apply only to this block on this date and update availability in Bigin.</p>
    <form onSubmit={save}><fieldset disabled={busy}>
      <label>Start<input type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>End<input type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} /></label>
      <label>Management PIN<input type="password" required inputMode="numeric" pattern="[0-9]{4,12}" minLength={4} maxLength={12} autoComplete="off" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} /></label>
      {error && <p className="block-edit-error" role="alert">{error}</p>}
      <div className="block-edit-actions"><button type="submit">{busy ? 'Updating…' : 'Save changes'}</button><button type="button" onClick={() => change(true)}>Remove block</button><button type="button" onClick={() => { setOpen(false); setPin(''); setError('') }}>Cancel</button></div>
    </fieldset></form>
  </section>
}
