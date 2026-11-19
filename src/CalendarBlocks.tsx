import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Block = { id: string; ownerId: string; start: string; end: string }
type Props = { member: { id: string; team: string; name: string }; api: (path: string, method?: string, body?: object) => Promise<{ blocks: Block[] }>; onClose: () => void }
const format = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })

export default function CalendarBlocks({ member, api, onClose }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([])
  const [mode, setMode] = useState('day')
  const [date, setDate] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [now] = useState(() => Date.now())
  useEffect(() => {
    let active = true
    api('/calendar-blocks').then(data => { if (active) setBlocks(data.blocks) }).catch(reason => { if (active) setError(reason.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
    // The selected member key remounts this editor; api uses the unlocked PIN.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const data = await api('/calendar-blocks', 'POST', { team: member.team, ownerId: member.id, mode: mode === 'dates' ? 'dates' : 'times', start: mode === 'day' ? `${date}T${start}` : start, end: mode === 'day' ? `${date}T${end}` : end })
      setBlocks(data.blocks); setNotice('Calendar block saved in Bigin. Overlapping appointment times are unavailable.'); setStart(''); setEnd('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save calendar block.') }
    finally { setBusy(false) }
  }
  async function remove(block: Block) {
    if (!window.confirm('Remove this block and reopen this time for appointments?')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await api('/calendar-blocks', 'DELETE', { team: member.team, ownerId: member.id, id: block.id })
      setBlocks(data.blocks); setNotice('Calendar block removed from Bigin.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove calendar block.') }
    finally { setBusy(false) }
  }
  const ownBlocks = blocks.filter(block => block.ownerId === member.id && Date.parse(block.end) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return <section className="calendar-block-editor" aria-label={`Calendar blocks for ${member.name}`}>
    <h4>Block appointment times</h4>
    <p>All dates and times use Eastern Time (America/New_York). Blocks apply to this person’s Bigin calendar across their booking pages. Existing appointments stay scheduled.</p>
    {error && <p className="team-error" role="alert">{error}</p>}
    {notice && <p className="team-notice" role="status">{notice}</p>}
    <form onSubmit={save}><fieldset disabled={busy}>
      <label>Block type<select value={mode} onChange={event => { setMode(event.target.value); setStart(''); setEnd(''); setError(''); setNotice('') }}>
        <option value="day">Specific date and time range</option>
        <option value="times">Start and end date/time</option>
        <option value="dates">Full day or date range</option>
      </select></label>
      {mode === 'day' && <label>Date<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>}
      <label>{mode === 'dates' ? 'First day (included)' : 'Start'}<input required type={mode === 'day' ? 'time' : mode === 'dates' ? 'date' : 'datetime-local'} value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>{mode === 'dates' ? 'Last day (included)' : 'End'}<input required type={mode === 'day' ? 'time' : mode === 'dates' ? 'date' : 'datetime-local'} value={end} onChange={event => setEnd(event.target.value)} /></label>
      <button className="team-primary" type="submit">{busy ? 'Please wait…' : 'Save calendar block'}</button>
    </fieldset></form>
    <h4>Upcoming and active blocks</h4>
    {busy && <p role="status">Updating calendar blocks…</p>}
    {!busy && !error && !ownBlocks.length && <p>No scheduled calendar blocks.</p>}
    <ul>{ownBlocks.map(block => <li key={block.id}><span>{format.format(new Date(block.start))} — {format.format(new Date(block.end))} (end excluded)</span><button type="button" disabled={busy} onClick={() => remove(block)}>Remove block</button></li>)}</ul>
    <button type="button" disabled={busy} onClick={onClose}>Close calendar blocks</button>
  </section>
}
