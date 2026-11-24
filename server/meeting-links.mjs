import { biginRequest } from './submissions.mjs'
import { getMembers } from './teams.mjs'
import { isManagedCalendarBlock } from './calendar-blocks.mjs'
const pending = new Set()
const id = value => { if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Select a valid meeting and deal.') }
export async function dealMeetings(dealId, request = biginRequest) {
  id(dealId)
  const events = []
  for (let page = 1; ; page++) {
    const result = await request(`Pipelines/${dealId}/Events?${new URLSearchParams({ fields: 'Event_Title,Related_To,Start_DateTime,End_DateTime,Modified_Time,Recurring_Activity', per_page: '200', page: String(page) })}`)
    for (const event of result.data || []) if ((!event.Related_To?.id || event.Related_To.id === dealId) && !event.$event_cancelled && !isManagedCalendarBlock(event)) events.push(event)
    if (!result.info?.more_records) return events
  }
}
export async function meetingDate(dealId, request = biginRequest) {
  const events = await dealMeetings(dealId, request)
  return events.length === 1 ? events[0].Start_DateTime || null : null
}
export async function linkMeeting(input, request = biginRequest, loadMembers = getMembers) {
  id(input.id); id(input.dealId); id(input.contactId)
  const keys = [`event:${input.id}`, `deal:${input.dealId}`]
  if (keys.some(key => pending.has(key))) throw new Error('This meeting or deal is being connected. Please retry.')
  keys.forEach(key => pending.add(key))
  try {
    const event = (await request(`Events/${input.id}`)).data?.[0]
    const deal = (await request(`Pipelines/${input.dealId}`)).data?.[0]
    const members = await loadMembers()
    if (!event || event.$event_cancelled || isManagedCalendarBlock(event)) throw new Error('Select an active appointment.')
    if (!members.some(member => ['sellers', 'customer-service', 'nutritionists'].includes(member.team) && member.id === event.Owner?.id)) throw new Error('Select a meeting on the team calendar.')
    if (!input.version || event.Modified_Time !== input.version) throw new Error('This meeting changed. Refresh before connecting it.')
    if (!deal || !['New Leads', 'Customer Service'].includes(deal.Pipeline?.name) || deal.Contact_Name?.id !== input.contactId) throw new Error('Select a deal belonging to this client.')
    if (!Number.isFinite(Date.parse(event.Start_DateTime))) throw new Error('This meeting has no valid start time. Correct it in Bigin before connecting it.')
    const module = event.$related_module || event.$se_module
    if (event.Related_To?.id && !(event.Related_To.id === input.dealId && ['Deals', 'Pipelines'].includes(module)) && !(event.Related_To.id === input.contactId && module === 'Contacts')) throw new Error('This meeting is already linked to another record.')
    if (event.Recurring_Activity || event.$recurrence_id) throw new Error('Select a single meeting, not a recurring series.')
    const existing = await dealMeetings(input.dealId, request)
    if (existing.some(other => other.id !== input.id)) throw new Error('This deal already has a meeting. Each deal can have only one meeting.')
    const result = await request(`Events/${input.id}`, 'PUT', { data: [{ id: input.id, Related_To: { id: input.dealId }, $related_module: 'Deals' }], trigger: [] })
    if (result.data?.[0]?.code !== 'SUCCESS') throw new Error('Bigin did not confirm the meeting connection.')
    const saved = (await request(`Events/${input.id}`)).data?.[0]
    if (saved?.Related_To?.id !== input.dealId || !['Deals', 'Pipelines'].includes(saved.$related_module || saved.$se_module)) throw new Error('The meeting connection could not be verified. Refresh before retrying.')
    let warning
    try {
      const update = await request(`Pipelines/${input.dealId}`, 'PUT', { data: [{ id: input.dealId, Evaluation_date_and_hour: saved.Start_DateTime }], trigger: [] })
      if (update.data?.[0]?.code !== 'SUCCESS') throw new Error('Field update was not confirmed.')
      const fresh = (await request(`Pipelines/${input.dealId}`)).data?.[0]
      if (Date.parse(fresh?.Evaluation_date_and_hour) !== Date.parse(saved.Start_DateTime)) throw new Error('Field readback differs.')
    } catch {
      warning = 'The meeting is connected, but Evaluation date and hour under Other Info could not be saved and verified in Bigin. Refresh and connect the same meeting again to retry.'
    }
    return { linked: true, evaluationTime: saved.Start_DateTime, evaluationSaved: !warning, warning }
  } finally { keys.forEach(key => pending.delete(key)) }
}
