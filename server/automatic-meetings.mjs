import { biginRequest } from './submissions.mjs'
import { linkMeeting } from './meeting-links.mjs'
import { isManagedCalendarBlock } from './calendar-blocks.mjs'

// Only submissions explicitly registered by the booking form are reconciled.
// Never infer identity from an event title or a client's name.
export async function reconcileBooking(progress, peers, request = biginRequest, connect = linkMeeting, now = Date.now()) {
  const watch = progress.meetingWatch
  if (!progress.dealId || !watch || watch.complete) return false
  if (now > Date.parse(watch.started) + 86400000) {
    watch.status = 'No confirmed appointment was found within the booking window.'
    return true
  }
  if (peers.some(other => other !== progress && other.dealId !== progress.dealId && other.contactId === progress.contactId && other.meetingWatch && !other.meetingWatch.complete && now <= Date.parse(other.meetingWatch.started) + 86400000)) {
    watch.status = 'Waiting to identify the appointment: more than one booking is pending for this client.'
    return true
  }
  const events = []
  for (let page = 1; ; page++) {
    const result = await request(`Contacts/${progress.contactId}/Events?${new URLSearchParams({ fields: 'Event_Title,Owner,Related_To,Created_Time,Modified_Time,Start_DateTime,Recurring_Activity,Participants', per_page: '200', page: String(page) })}`)
    events.push(...(result.data || []))
    if (!result.info?.more_records) break
  }
  // Moving Related_To from contact to deal can remove the event from this
  // related list. Still allow a verified evaluation-field synchronization retry.
  if (watch.eventId && !events.some(event => event.id === watch.eventId)) {
    const saved = (await request(`Events/${watch.eventId}`)).data?.[0]
    if (saved) events.push(saved)
  }
  const matches = events.filter(event =>
    Date.parse(event.Created_Time) >= Date.parse(watch.started) &&
    Date.parse(event.Created_Time) <= Date.parse(watch.started) + 86400000 &&
    !event.$event_cancelled && !event.Recurring_Activity && !event.$recurrence_id && !isManagedCalendarBlock(event) &&
    (!event.Related_To?.id || event.Related_To.id === progress.contactId || event.Related_To.id === progress.dealId))
  if (matches.length !== 1) {
    watch.status = matches.length ? 'More than one appointment matches this booking. Automatic connection is pending.' : 'Waiting for the confirmed booking in Bigin.'
    return true
  }
  const event = matches[0]
  // Keep the chosen ID in the receipt so a field-sync retry cannot switch events.
  if (watch.eventId && watch.eventId !== event.id) {
    watch.status = 'The appointment changed. Automatic connection is pending.'
    return true
  }
  watch.eventId = event.id
  const result = await connect({ id: event.id, dealId: progress.dealId, contactId: progress.contactId, version: event.Modified_Time }, request)
  watch.complete = Boolean(result.evaluationSaved)
  watch.status = watch.complete ? 'Meeting connected automatically. Evaluation date saved.' : result.warning
  return true
}
