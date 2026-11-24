import { biginRequest } from './submissions.mjs'
import { getMembers, getBiginUsers } from './teams.mjs'
import { isManagedCalendarBlock } from './calendar-blocks.mjs'

export async function getCalendar(date, request = biginRequest) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Select a valid calendar date.')
  }
  const [members, users] = await Promise.all([getMembers(), getBiginUsers(request)])
  const people = members.filter(member => ['sellers', 'customer-service', 'nutritionists'].includes(member.team))
  const unique = [...new Set(people.map(member => member.id))].map(id => {
    const member = people.find(person => person.id === id)
    return { id, name: member.name, email: users.find(user => user.id === id)?.email || '', teams: people.filter(person => person.id === id).map(person => person.team) }
  })
  const day = Date.parse(`${date}T00:00:00Z`)
  const start = new Date(day - 86400000).toISOString().replace('.000Z', '+00:00')
  const end = new Date(day + 2 * 86400000).toISOString().replace('.000Z', '+00:00')
  const criteria = `((Start_DateTime:less_than:${end})and(End_DateTime:greater_than:${start}))`
  const events = []
  for (let page = 1; ; page++) {
    const result = await request(`Events/search?${new URLSearchParams({ criteria, page: String(page), per_page: '200' })}`)
    for (const event of result.data || []) {
      if (unique.some(person => person.id === event.Owner?.id) && !event.$event_cancelled) {
        events.push({
          id: event.id, title: event.Event_Title, start: event.Start_DateTime, end: event.End_DateTime,
          ownerId: event.Owner.id, allDay: Boolean(event.All_day),
          editableBlock: isManagedCalendarBlock(event),
          location: event.Venue || '', description: event.Description || '',
          relatedTo: event.Related_To?.name || '', relatedId: event.Related_To?.id || '', relatedModule: event.$se_module || event.$related_module || '', version: event.Modified_Time || '',
          participants: (event.Participants || []).map(person => ({
            name: person.name || '', email: person.Email || '', status: person.status || '',
          })),
        })
      }
    }
    if (!result.info?.more_records) break
  }
  return { people: unique, events }
}

export async function cancelCalendarMeeting(input, request = biginRequest, loadMembers = getMembers) {
  if (typeof input.id !== 'string' || !/^\d+$/.test(input.id)) throw new Error('Select a valid meeting.')
  const event = (await request(`Events/${input.id}`)).data?.[0]
  if (!event) throw new Error('This meeting no longer exists. Refresh the calendar.')
  const members = await loadMembers()
  if (!members.some(member => ['sellers', 'customer-service', 'nutritionists'].includes(member.team) && member.id === event.Owner?.id)) throw new Error('This meeting is outside the team calendar.')
  if (isManagedCalendarBlock(event)) throw new Error('Use the block editor to remove calendar blocks.')
  if (event.Recurring_Activity || event.$recurrence_id) throw new Error('Cancel recurring meetings directly in Bigin to choose the correct occurrence.')
  if (!input.version || input.version !== event.Modified_Time || input.ownerId !== event.Owner?.id) throw new Error('This meeting changed. Refresh the calendar before cancelling.')
  if (event.$event_cancelled) return { cancelled: true }
  const result = await request(`Events/${input.id}`, 'DELETE')
  if (result.data?.[0]?.code !== 'SUCCESS') throw new Error('Bigin did not confirm cancellation. Refresh the calendar before retrying.')
  return { cancelled: true }
}
