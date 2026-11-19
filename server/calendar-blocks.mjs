import { biginRequest } from './submissions.mjs'
import { getMembers } from './teams.mjs'

const title = 'Dharma calendar block'
const managedTitles = [title, 'Out of office', 'Lunch']
const marker = 'Managed by Dharma Forms calendar blocking v1.'
export const isManagedCalendarBlock = event => managedTitles.includes(event?.Event_Title) && event?.Description === marker
const zone = 'America/New_York'
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function easternInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid date and time.')
  const matches = [-4, -5].map(offset => new Date(`${value}:00${offset === -4 ? '-04:00' : '-05:00'}`))
    .filter(date => Number.isFinite(+date) && formatter.format(date).replace(' ', 'T') === value)
  if (matches.length !== 1) throw new Error('This Eastern Time is invalid or ambiguous because of daylight saving time. Choose another time.')
  return matches[0].toISOString().replace('.000Z', '+00:00')
}

export function blockInterval(input) {
  let start = input.start
  let end = input.end
  if (input.mode === 'dates') {
    for (const value of [start, end]) if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Select valid start and end dates.')
    const next = new Date(`${end}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    start += 'T00:00'
    end = next.toISOString().slice(0, 10) + 'T00:00'
  } else if (input.mode !== 'times') throw new Error('Select a valid block type.')
  start = easternInstant(start)
  end = easternInstant(end)
  if (end <= start) throw new Error('The end must be after the start.')
  if (Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new Error('A block can cover at most one year.')
  return { start, end }
}

export async function listCalendarBlocks(request = biginRequest, loadMembers = getMembers) {
  const members = await loadMembers()
  const ids = new Set(members.filter(m => m.team !== 'agents').map(m => m.id))
  const blocks = []
  // Search per owner so daily blocks do not hit Bigin's search-result limit.
  for (const ownerId of ids) for (let page = 1; ; page++) {
    const cutoff = new Date(Date.now() - 86400000).toISOString().replace(/\.\d{3}Z$/, '+00:00')
    const result = await request(`Events/search?${new URLSearchParams({ criteria: `(((((Event_Title:equals:${title})or(Event_Title:equals:Out of office))or(Event_Title:equals:Lunch))and(Owner:equals:${ownerId}))and(End_DateTime:greater_than:${cutoff}))`, page: String(page), per_page: '200' })}`)
    for (const event of result.data || []) if (ids.has(event.Owner?.id) && managedTitles.includes(event.Event_Title) && event.Description === marker && !event.$event_cancelled) blocks.push({ id: event.id, ownerId: event.Owner.id, start: event.Start_DateTime, end: event.End_DateTime, title: event.Event_Title })
    if (!result.info?.more_records) break
  }
  return blocks
}

export async function changeCalendarBlock(input, remove = false, request = biginRequest, loadMembers = getMembers) {
  const members = await loadMembers()
  if (!['sellers', 'nutritionists', 'customer-service'].includes(input.team) || !members.some(m => m.team === input.team && m.id === input.ownerId)) throw new Error('Select an assigned calendar member.')
  const loadOwner = async () => members.filter(member => member.id === input.ownerId)
  if (remove) {
    if (typeof input.id !== 'string' || !/^\d+$/.test(input.id)) throw new Error('Select a valid calendar block.')
    const result = await request(`Events/${input.id}`)
    const event = result.data?.[0]
    if (event?.Owner?.id !== input.ownerId || !isManagedCalendarBlock(event)) throw new Error('Only blocks created by this app can be removed or changed here.')
    if ((input.expectedStart && Date.parse(input.expectedStart) !== Date.parse(event.Start_DateTime)) || (input.expectedEnd && Date.parse(input.expectedEnd) !== Date.parse(event.End_DateTime))) throw new Error('This block changed since you opened it. Refresh the calendar before editing.')
    if (remove === 'update') {
      const { start, end } = blockInterval(input)
      if (Date.parse(end) <= Date.now()) throw new Error('The block must end in the future.')
      const result = await request('Events', 'PUT', { data: [{ id: input.id, Start_DateTime: start, End_DateTime: end }], trigger: [] })
      if (result.data?.[0]?.code !== 'SUCCESS') throw new Error('Bigin could not update the calendar block. Refresh before retrying.')
      const saved = (await request(`Events/${input.id}`)).data?.[0]
      if (Date.parse(saved?.Start_DateTime) !== Date.parse(start) || Date.parse(saved?.End_DateTime) !== Date.parse(end)) throw new Error('Bigin saved different block times. Refresh the calendar to review them.')
    } else {
      const deleted = await request(`Events/${input.id}`, 'DELETE')
      if (deleted.data?.[0]?.code !== 'SUCCESS') throw new Error('Bigin could not remove the calendar block. Refresh and retry.')
    }
  } else {
    const { start, end } = blockInterval(input)
    if (Date.parse(end) <= Date.now()) throw new Error('The block must end in the future.')
    const existing = await listCalendarBlocks(request, loadOwner)
    if (existing.some(b => b.ownerId === input.ownerId && Date.parse(b.start) === Date.parse(start) && Date.parse(b.end) === Date.parse(end))) return existing
    const result = await request('Events', 'POST', { data: [{ Event_Title: title, Owner: { id: input.ownerId }, Start_DateTime: start, End_DateTime: end, Description: marker, Participants: [] }], trigger: [] })
    if (result.data?.[0]?.code !== 'SUCCESS') throw new Error('Bigin could not save the calendar block. Refresh before retrying.')
  }
  return listCalendarBlocks(request, loadOwner)
}
