import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelCalendarMeeting, rescheduleCalendarMeeting } from './calendar.mjs'
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

test('rescheduling preserves the relationship and verifies the linked deal evaluation date', async () => {
  let record = { ...event, Related_To: { id: '56' }, $related_module: 'Deals' }
  let evaluation
  const writes = []
  const result = await rescheduleCalendarMeeting({ ...input, start: '2026-12-01T10:00', end: '2026-12-01T10:20' }, async (path, method, body) => {
    if (method === 'PUT') {
      writes.push([path, body.data[0]])
      if (path === 'Events/12') record = { ...record, ...body.data[0] }
      else evaluation = body.data[0].Evaluation_date_and_hour
      return { data: [{ code: 'SUCCESS' }] }
    }
    return { data: [path === 'Events/12' ? record : { Evaluation_date_and_hour: evaluation }] }
  }, members)
  assert.equal(result.rescheduled, true)
  assert.equal(result.warning, undefined)
  assert.deepEqual(writes, [
    ['Events/12', { id: '12', Start_DateTime: '2026-12-01T15:00:00+00:00', End_DateTime: '2026-12-01T15:20:00+00:00' }],
    ['Pipelines/56', { id: '56', Evaluation_date_and_hour: '2026-12-01T15:00:00+00:00' }],
  ])
})
test('rescheduling refuses stale, blocked, recurring and cancelled meetings before writes', async () => {
  for (const change of [{ Modified_Time: 'v2' }, { Owner: { id: '99' } }, { Recurring_Activity: {} }, { $event_cancelled: true }, { All_day: true }, { Event_Title: 'Lunch', Description: 'Managed by Dharma Forms calendar blocking v1.' }]) {
    await assert.rejects(rescheduleCalendarMeeting({ ...input, start: '2026-12-01T10:00', end: '2026-12-01T10:20' }, async (path, method) => {
      assert.notEqual(method, 'PUT')
      return { data: [{ ...event, ...change }] }
    }, members))
  }
  await assert.rejects(rescheduleCalendarMeeting({ ...input, start: '2026-12-01T10:00', end: '2026-12-01T09:00' }, async () => assert.fail('Invalid interval reached CRM'), members), /end must be after/)
})
