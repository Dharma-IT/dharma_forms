import test from 'node:test'
import assert from 'node:assert/strict'
import { linkMeeting, meetingDate } from './meeting-links.mjs'
const original = { id: '12', Owner: { id: '34' }, Modified_Time: 'v1', Start_DateTime: '2026-11-25T14:00:00-05:00', Event_Title: 'Evaluation' }
const deal = { id: '56', Contact_Name: { id: '78' }, Pipeline: { name: 'New Leads' } }
const input = { id: '12', dealId: '56', contactId: '78', version: 'v1' }
const members = async () => [{ id: '34', team: 'sellers' }]
function crm(change = {}, existing = []) {
  let event = { ...original, ...change }
  let pipeline = { ...deal }
  const writes = []
  const request = async (path, method, body) => {
    if (method === 'PUT') {
      writes.push([path, body])
      if (path === 'Events/12') event = { ...event, ...body.data[0] }
      else pipeline = { ...pipeline, ...body.data[0] }
      return { data: [{ code: 'SUCCESS' }] }
    }
    if (path.includes('/Events?')) return { data: existing }
    return { data: [path === 'Events/12' ? event : pipeline] }
  }
  return { request, writes }
}
test('connects the actual Bigin relationship and synchronizes evaluation from the meeting', async () => {
  const { request, writes } = crm()
  const result = await linkMeeting(input, request, members)
  assert.equal(result.linked, true)
  assert.equal(result.evaluationTime, original.Start_DateTime)
  assert.equal(result.warning, undefined)
  assert.equal(result.evaluationSaved, true)
  assert.deepEqual(writes, [
    ['Events/12', { data: [{ id: '12', Related_To: { id: '56' }, $related_module: 'Deals' }], trigger: [] }],
    ['Pipelines/56', { data: [{ id: '56', Evaluation_date_and_hour: original.Start_DateTime }], trigger: [] }],
  ])
})
test('refuses conflicting deals, a second meeting, cancelled events, stale versions and wrong contacts before writing', async () => {
  for (const [change, existing, override] of [
    [{ Related_To: { id: '99' }, $related_module: 'Deals' }, [], {}],
    [{}, [{ ...original, id: '99', Related_To: { id: '56' } }], {}],
    [{ $event_cancelled: true }, [], {}],
    [{ Modified_Time: 'v2' }, [], {}],
    [{}, [], { contactId: '99' }],
    [{ Owner: { id: '99' } }, [], {}],
  ]) {
    const { request, writes } = crm(change, existing)
    await assert.rejects(linkMeeting({ ...input, ...override }, request, members))
    assert.equal(writes.length, 0)
  }
})
test('evaluation follows a rescheduled meeting and excludes cancelled or ambiguous meetings', async () => {
  const moved = { ...original, Start_DateTime: '2026-12-01T10:00:00-05:00' }
  assert.equal(await meetingDate('56', crm({}, [moved]).request), moved.Start_DateTime)
  assert.equal(await meetingDate('56', crm({}, [{ ...moved, $event_cancelled: true }]).request), null)
  assert.equal(await meetingDate('56', crm({}, [moved, { ...moved, id: '99' }]).request), null)
  assert.equal(await meetingDate('56', crm().request), null)
})
test('a field synchronization failure reports the saved connection without claiming it failed', async () => {
  const { request } = crm()
  const result = await linkMeeting(input, async (path, method, body) => {
    if (path === 'Pipelines/56' && method === 'PUT') throw new Error('Field unavailable')
    return request(path, method, body)
  }, members)
  assert.equal(result.linked, true)
  assert.equal(result.evaluationSaved, false)
  assert.match(result.warning, /Other Info/)
})

test('does not confirm the Other Info date when Bigin readback is empty or differs', async () => {
  for (const value of [undefined, '2026-11-26T14:00:00-05:00']) {
    const { request } = crm()
    let updated = false
    const result = await linkMeeting(input, async (path, method, body) => {
      if (path === 'Pipelines/56' && method === 'PUT') updated = true
      if (path === 'Pipelines/56' && !method && updated) return { data: [{ ...deal, Evaluation_date_and_hour: value }] }
      return request(path, method, body)
    }, members)
    assert.equal(result.linked, true)
    assert.equal(result.evaluationSaved, false)
    assert.match(result.warning, /could not be saved and verified/)
  }
})

test('verifies equivalent Bigin evaluation timestamps across timezone offsets', async () => {
  const { request } = crm()
  let updated = false
  const result = await linkMeeting(input, async (path, method, body) => {
    if (path === 'Pipelines/56' && method === 'PUT') updated = true
    if (path === 'Pipelines/56' && !method && updated) return { data: [{ ...deal, Evaluation_date_and_hour: '2026-11-25T19:00:00Z' }] }
    return request(path, method, body)
  }, members)
  assert.equal(result.evaluationSaved, true)
})
