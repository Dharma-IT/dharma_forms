import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelCalendarMeeting } from './calendar.mjs'
const event = { id: '12', Owner: { id: '34' }, Modified_Time: 'v1', Event_Title: 'Consultation' }
const input = { id: '12', ownerId: '34', version: 'v1' }
const members = async () => [{ id: '34', team: 'sellers' }]
test('cancellation deletes only the verified meeting and requires CRM confirmation', async () => {
  const calls = []
  const request = async (path, method) => {
    calls.push([path, method])
    return method === 'DELETE' ? { data: [{ code: 'SUCCESS' }] } : { data: [event] }
  }
  assert.deepEqual(await cancelCalendarMeeting(input, request, members), { cancelled: true })
  assert.deepEqual(calls, [['Events/12', undefined], ['Events/12', 'DELETE']])
  await assert.rejects(cancelCalendarMeeting(input, async (path, method) => method === 'DELETE' ? { data: [{ code: 'FAILURE' }] } : { data: [event] }, members), /did not confirm/)
})
test('cancellation refuses stale, unrelated, recurring and managed block events before deletion', async () => {
  for (const change of [
    { Modified_Time: 'v2' }, { Owner: { id: '99' } }, { Recurring_Activity: { RRULE: 'FREQ=DAILY' } },
    { Event_Title: 'Lunch', Description: 'Managed by Dharma Forms calendar blocking v1.' },
  ]) {
    await assert.rejects(cancelCalendarMeeting(input, async (path, method) => {
      assert.notEqual(method, 'DELETE')
      return { data: [{ ...event, ...change }] }
    }, members))
  }
  await assert.rejects(cancelCalendarMeeting({ ...input, id: '../12' }, async () => assert.fail('Invalid ID reached CRM'), members))
})
