import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileBooking } from './automatic-meetings.mjs'

const now = Date.parse('2026-11-25T15:00:00Z')
const booking = () => ({ dealId: '56', contactId: '78', meetingWatch: { ownerId: '34', started: '2026-11-25T14:00:00Z' } })
const event = { id: '12', Owner: { id: '34' }, Related_To: { id: '78' }, Created_Time: '2026-11-25T14:05:00Z', Modified_Time: 'v1' }
test('automatically connects one new meeting using exact client, and saves completion', async () => {
  const progress = booking()
  const calls = []
  await reconcileBooking(progress, [progress], async path => {
    assert.match(path, /^Contacts\/78\/Events\?/)
    return { data: [event] }
  }, async input => { calls.push(input); return { evaluationSaved: true } }, now)
  assert.deepEqual(calls, [{ id: '12', dealId: '56', contactId: '78', version: 'v1' }])
  assert.equal(progress.meetingWatch.complete, true)
})
test('does not guess for old, conflicting, cancelled or ambiguous meetings', async () => {
  for (const events of [[], [{ ...event, Created_Time: '2026-11-24T00:00:00Z' }], [{ ...event, Related_To: { id: '99' } }], [{ ...event, $event_cancelled: true }], [event, { ...event, id: '13' }]]) {
    const progress = booking()
    await reconcileBooking(progress, [progress], async () => ({ data: events }), async () => assert.fail('Must not connect'), now)
    assert.ok(!progress.meetingWatch.complete)
  }
})
test('leaves competing submissions unresolved and stops completed or expired watches', async () => {
  const progress = booking()
  const competing = { ...booking(), dealId: '57' }
  await reconcileBooking(progress, [progress, competing], async () => assert.fail('Must not search'), undefined, now)
  assert.match(progress.meetingWatch.status, /more than one booking/)
  for (const change of [{ complete: true }, { started: '2026-11-23T00:00:00Z' }]) {
    Object.assign(progress.meetingWatch, change)
    await reconcileBooking(progress, [progress], async () => assert.fail('Must not search'), undefined, now)
  }
})
test('does not report completion until the evaluation date is verified', async () => {
  const progress = booking()
  await reconcileBooking(progress, [progress], async () => ({ data: [event] }), async () => ({ evaluationSaved: false, warning: 'Retry field synchronization' }), now)
  assert.equal(progress.meetingWatch.complete, false)
  assert.equal(progress.meetingWatch.status, 'Retry field synchronization')
})

test('links the unique new client event even when booking-page host differs from deal owner', async () => {
  const progress = booking()
  let linked = false
  await reconcileBooking(progress, [progress], async () => ({ data: [{ ...event, Owner: { id: '99' } }] }), async () => { linked = true; return { evaluationSaved: true } }, now)
  assert.equal(linked, true)
  assert.equal(progress.meetingWatch.complete, true)
})

test('field synchronization retries recover the event after it moves from contact to deal', async () => {
  const progress = booking()
  progress.meetingWatch.eventId = event.id
  await reconcileBooking(progress, [progress], async path => path === 'Events/12' ? { data: [{ ...event, Related_To: { id: '56' } }] } : { data: [] }, async () => ({ evaluationSaved: true }), now)
  assert.equal(progress.meetingWatch.complete, true)
})
