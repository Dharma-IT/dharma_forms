import { easternInstant, listCalendarBlocks } from './calendar-blocks.mjs'
import { getMembers } from './teams.mjs'
import { biginRequest } from './submissions.mjs'

const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayKey = value => dayFormat.format(new Date(value))
const nextDay = day => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)

// Extend the bookable year daily. Individual dates preserve New York wall time
// over DST, unlike Bigin's fixed-UTC recurring event expansion.
export function planOutOfOffice(members, existing, now = new Date()) {
  const today = dayKey(now)
  const horizon = new Date(`${today}T12:00:00Z`)
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 1)
  const through = horizon.toISOString().slice(0, 10)
  const events = []
  const people = [...new Map(members.filter(m => ['sellers', 'customer-service'].includes(m.team)).map(member => [member.id, member])).values()]
  for (const member of people) {
    const own = existing.filter(b => b.ownerId === member.id && b.title === 'Out of office')
    const latest = own.map(b => dayKey(b.start)).sort().at(-1)
    // Earlier missing dates are intentional exceptions; only extend coverage.
    for (let day = latest ? nextDay(latest) : today; day <= through; day = nextDay(day)) {
      for (const [start, end] of [[`${day}T00:00`, `${day}T10:40`], [`${day}T19:00`, `${nextDay(day)}T00:00`]]) {
        const startInstant = easternInstant(start)
        const endInstant = easternInstant(end)
        if (Date.parse(endInstant) <= +now) continue
        events.push({ Event_Title: 'Out of office', Owner: { id: member.id }, Start_DateTime: startInstant, End_DateTime: endInstant, Description: 'Managed by Dharma Forms calendar blocking v1.', Participants: [] })
      }
    }
  }
  return events
}

export async function extendOutOfOffice(request = biginRequest, loadMembers = getMembers, now = new Date()) {
  const members = (await loadMembers()).filter(m => ['sellers', 'customer-service'].includes(m.team))
  const existing = await listCalendarBlocks(request, async () => members)
  const events = planOutOfOffice(members, existing, now)
  let created = 0
  for (let offset = 0; offset < events.length; offset += 100) {
    const batch = events.slice(offset, offset + 100)
    const result = await request('Events', 'POST', { data: batch, trigger: [] })
    if (result.data?.length !== batch.length || result.data.some(row => row.code !== 'SUCCESS')) throw new Error('Out-of-office extension needs review: Bigin rejected one or more blocks.')
    // Bigin can adjust an end time on a DST transition during bulk insertion.
    // Check persisted instants rather than relying only on a SUCCESS response.
    for (let index = 0; index < batch.length; index++) {
      const id = result.data[index].details?.id
      if (!id) throw new Error('Bigin did not return an out-of-office block ID.')
      const expected = batch[index]
      let saved = (await request(`Events/${id}`)).data?.[0]
      const matches = event => event?.Owner?.id === expected.Owner.id && Date.parse(event.Start_DateTime) === Date.parse(expected.Start_DateTime) && Date.parse(event.End_DateTime) === Date.parse(expected.End_DateTime)
      if (!matches(saved)) {
        if (saved?.Owner?.id !== expected.Owner.id) throw new Error('Out-of-office block owner verification failed.')
        const correction = await request('Events', 'PUT', { data: [{ id, Start_DateTime: expected.Start_DateTime, End_DateTime: expected.End_DateTime }], trigger: [] })
        if (correction.data?.[0]?.code !== 'SUCCESS') throw new Error('Could not correct an out-of-office block time.')
        saved = (await request(`Events/${id}`)).data?.[0]
        if (!matches(saved)) throw new Error('Out-of-office block time verification failed.')
      }
    }
    created += batch.length
  }
  return created
}
