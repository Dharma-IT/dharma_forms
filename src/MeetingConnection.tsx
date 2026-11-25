import { useEffect, useState } from 'react'
import { authenticatedFetch } from './auth'

export default function MeetingConnection({ booking }: { booking: { submissionKey: string } }) {
  const [status, setStatus] = useState('Waiting for your confirmed appointment.')
  const [complete, setComplete] = useState(false)
  useEffect(() => {
    let active = true
    let timer: number | undefined
    const check = async () => {
      let done = false
      try {
        const response = await authenticatedFetch(`/api/bigin/submissions/${booking.submissionKey}/meeting`)
        const result = await response.json()
        if (!response.ok) throw new Error('Status unavailable')
        if (!active) return
        setStatus(result.status)
        done = Boolean(result.complete)
        setComplete(done)
      } catch {
        if (active) setStatus('Checking your appointment connection. We will retry automatically.')
      }
      if (active && !done) timer = window.setTimeout(() => { void check() }, 10000)
    }
    void check()
    return () => { active = false; window.clearTimeout(timer) }
  }, [booking.submissionKey])
  return <section className="meeting-connection">
    <h3>{complete ? 'Appointment connected' : 'Automatic appointment connection'}</h3>
    <p>Complete the calendar booking using the same client email. Your confirmed appointment and evaluation date will be attached to this deal automatically.</p>
    <p role="status">{status}</p>
  </section>
}
