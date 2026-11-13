import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { bookingConfig as config } from './booking-config'
import './App.css'

type Details = {
  agent: string; firstName: string; lastName: string; email: string; phone: string;
  dialCode: string; language: string; state: string; channel: string; source: string;
  team: string; host: string; pipeline: string; stage: string; notes: string
}
const initial: Details = { agent: '', firstName: '', lastName: '', email: '', phone: '', dialCode: '+63', language: '', state: '', channel: '', source: '', team: '', host: '', pipeline: '', stage: '', notes: '' }
type Pipeline = { id: string; name: string; subPipelines: string[]; stages: string[]; channels: string[]; sources: string[] }
function Field({ label, required = true, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="field"><span>{label}{required && <span className="required">*</span>}</span>{children}</label>
}
function App() {
  const [details, setDetails] = useState<Details>(initial)
  const [step, setStep] = useState(1)
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ contactReused: boolean; dealId: string } | null>(null)
  const submissionKey = useRef(crypto.randomUUID())
  const submittedDetails = useRef('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/bigin/options', { signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load Bigin pipelines.')
      setPipelines(data.pipelines)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message || 'Start the local Bigin API to load pipelines.') })
    return () => controller.abort()
  }, [])
  const teams = [
    { id: 'nutritionists', name: 'Nutritionist', personLabel: 'Nutritionist', members: config.nutritionists },
    { id: 'sellers', name: 'Sellers', personLabel: 'Seller', members: config.sellers },
    { id: 'customer-service', name: 'Customer Service', personLabel: 'Customer Service Agent', members: config.customerService },
  ]
  const team = teams.find(item => item.id === details.team)
  const host = team?.members.find(item => item.id === details.host)
  const agent = config.agents.find(item => item.id === details.agent)
  const pipeline = pipelines.find(item => item.id === details.pipeline)
  const update = (key: keyof Details, value: string) => setDetails(current => ({ ...current, [key]: value, ...(key === 'team' ? { host: '' } : {}), ...(key === 'pipeline' ? { stage: '', channel: '', source: '' } : {}) }))
  const input = (key: keyof Details, type = 'text', autocomplete?: string) => <input type={type} value={details[key]} onChange={e => update(key, e.target.value)} required autoComplete={autocomplete} />
  const select = (key: keyof Details, options: { id: string; name: string }[], placeholder: string) => <select required value={details[key]} onChange={e => update(key, e.target.value)}><option value="" disabled>{placeholder}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
  const choices = (key: keyof Details, options: string[], placeholder: string) => select(key, options.map(value => ({ id: value, name: value })), placeholder)
  async function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const snapshot = JSON.stringify(details)
    if (saved && snapshot === submittedDetails.current) { setStep(2); return }
    if (submittedDetails.current && snapshot !== submittedDetails.current) {
      setError('A save was already attempted with different details. Check Bigin, then refresh to start a new submission.'); return
    }
    submittedDetails.current = snapshot
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/bigin/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey.current }, body: snapshot })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save to Bigin.')
      setSaved(data); setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not reach Bigin. Please retry.') }
    finally { setSaving(false) }
  }
  let bookingUrl = ''
  try { const url = new URL(host?.bookingUrl || ''); if (url.protocol === 'https:') bookingUrl = url.href } catch { /* Host has no configured booking page yet. */ }
  return <main className={`booking-layout${step === 2 ? ' calendar-layout' : ''}`}>
    <aside className="intro">
      <a className="brand" href="/" aria-label="Dharma Nutrition Clinic home"><span className="brand-mark" aria-hidden="true">D<span>C</span></span><span className="brand-name">DHARMA</span><span className="brand-subtitle">NUTRITION CLINIC</span></a>
      <div className="eyebrow">A LITTLE TIME. A NEW BEGINNING.</div>
      <h1>Schedule a<br />meeting with<br />our <em>team.</em></h1>
      <p className="intro-copy">Make the right connection.<br />Book a conversation for your client.</p>
      <ol className="steps" aria-label="Booking progress"><li className={step === 1 ? 'active' : 'complete'} aria-current={step === 1 ? 'step' : undefined}><span>{step === 2 ? '✓' : '01'}</span><div>Client & deal details<small>A few details to get started</small></div></li><li className={step === 2 ? 'active' : ''} aria-current={step === 2 ? 'step' : undefined}><span>02</span><div>Choose a time<small>Find a moment that works</small></div></li></ol>
      <div className="intro-footer"><span className="gold-dot" /> Thoughtful care starts with a conversation.</div>
    </aside>
    <section className="form-panel" aria-labelledby="form-title">
      <header className="panel-header"><span className="step-label">STEP {String(step).padStart(2, '0')} OF 02</span><span className="internal-badge">TEAM BOOKING</span><h2 id="form-title">{step === 1 ? 'Let’s get acquainted.' : 'Find the right time.'}</h2><p>{step === 1 ? 'Tell us about your client and who they’ll be meeting.' : 'Choose an available appointment on your team member’s calendar.'}</p></header>
      {step === 1 ? <form onSubmit={next}>
        {error && <p className="connection-note" role="alert">{error}</p>}
        <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field label="Agent (You)">{select('agent', config.agents, 'Select booking agent')}</Field>
        <div className="section-label">CLIENT DETAILS</div>
        <div className="two-col"><Field label="Client’s First Name">{input('firstName', 'text', 'given-name')}</Field><Field label="Client’s Last Name">{input('lastName', 'text', 'family-name')}</Field></div>
        <Field label="Client’s Email">{input('email', 'email', 'email')}</Field>
        <Field label="Client’s Phone Number"><div className="phone-field"><select aria-label="Calling code" value={details.dialCode} onChange={e => update('dialCode', e.target.value)}><option value="+63">PH +63</option><option value="+1">US +1</option><option value="+52">MX +52</option><option value="+34">ES +34</option><option value="+44">UK +44</option></select><input type="tel" required autoComplete="tel-national" pattern="[0-9 ()+.-]{6,20}" title="Enter a phone number using 6–20 digits, spaces, or phone punctuation." value={details.phone} onChange={e => update('phone', e.target.value)} /></div></Field>
        <div className="two-col"><Field label="Preferred Language">{choices('language', config.languages, 'Select language')}</Field><Field label="State">{choices('state', config.states, 'Select a U.S. state')}</Field></div>
        <div className="section-label">DEAL DETAILS</div>
        <Field label="Save deal to pipeline">{select('pipeline', pipelines.length ? pipelines : config.pipelines, 'Select a pipeline')}</Field>
        {pipeline && <Field label="Stage">{choices('stage', pipeline.stages, 'Select a stage')}</Field>}
        <div className="two-col"><Field label="Channel">{choices('channel', config.channels, 'Select channel')}</Field><Field label="Source">{choices('source', config.sources, 'Select source')}</Field></div>
        <Field label="Book with">{select('team', teams, 'Select a team')}</Field>
        {team && <Field label={team.personLabel}>{select('host', team.members, `Select a ${team.personLabel.toLowerCase()}`)}</Field>}
        <button className="primary" type="submit" disabled={saving || !pipeline}>{saving ? 'Saving to Bigin…' : 'Save contact & deal, then choose a time'} <span aria-hidden="true">→</span></button>
        <p className="form-footnote">This saves the deal before calendar booking. An existing email reuses the contact without changing its details.</p>
        </fieldset>
      </form> : <div className="calendar-step">
        <div className="summary"><div className="avatar">{details.firstName[0]}{details.lastName[0]}</div><div><strong>{details.firstName} {details.lastName}</strong><span>{details.email}</span></div><button type="button" onClick={() => setStep(1)}>Edit details</button></div>
        <dl className="booking-summary"><div><dt>Meeting with</dt><dd>{host?.name}<br /><small>{team?.name}</small></dd></div><div><dt>Booked by</dt><dd>{agent?.name}</dd></div><div><dt>Deal pipeline</dt><dd>{pipeline?.name}</dd></div></dl>
        {bookingUrl ? <><iframe key={host?.id} className="booking-frame" title={`Book a meeting with ${host?.name}`} src={bookingUrl} referrerPolicy="strict-origin-when-cross-origin" /><a className="calendar-link" href={bookingUrl} target="_blank" rel="noreferrer">Open calendar in a new tab ↗</a><p className="form-footnote">Complete the booking in the calendar to receive its confirmation. Client details may need to be entered again.</p></> : <div className="calendar-placeholder"><span className="calendar-icon" aria-hidden="true">▦</span><h3>Your team member’s calendar goes here.</h3><p>The form is ready to preview. Add this team member’s Bigin Booking Page link to enable appointment scheduling.</p><span className="preview-pill">PREVIEW · NO APPOINTMENT BOOKED</span></div>}
        <div className="connection-note" role="status">{saved?.contactReused ? 'Existing contact linked.' : 'Contact created.'} Deal saved to {pipeline?.name}. The appointment is only booked after you complete the calendar.</div>
        <button className="back-button" type="button" onClick={() => setStep(1)}>← Back to details</button>
      </div>}
    </section>
    <footer className="mobile-footer">DHARMA NUTRITION CLINIC</footer>
  </main>
}
export default App
