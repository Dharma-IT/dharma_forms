import test from 'node:test'
import assert from 'node:assert/strict'
import { blockInterval, easternInstant, changeCalendarBlock, listCalendarBlocks } from './calendar-blocks.mjs'

test('Eastern intervals respect winter, summer, and daylight saving transitions', () => {
  assert.equal(easternInstant('2026-11-23T10:00'), '2026-11-23T15:00:00+00:00')
  assert.equal(easternInstant('2026-07-23T10:00'), '2026-07-23T14:00:00+00:00')
  for (const value of ['2026-03-08T02:30', '2026-11-01T01:30', '2026-02-30T10:00', '2026-01-01T24:30', undefined]) assert.throws(() => easternInstant(value))
})

test('date ranges include the last day and use local midnight over DST', () => {
  assert.deepEqual(blockInterval({ mode: 'dates', start: '2026-03-08', end: '2026-03-08' }), { start: '2026-03-08T05:00:00+00:00', end: '2026-03-09T04:00:00+00:00' })
  for (const input of [
    { mode: 'dates', start: '2026-02-30', end: '2026-03-01' },
    { mode: 'dates', start: '2026-03-10', end: '2026-03-08' },
    { mode: 'times', start: '2026-11-23T11:00', end: '2026-11-23T10:00' },
    { mode: 'times', start: '2026-11-23T10:00', end: '2026-11-23T10:00' },
  ]) assert.throws(() => blockInterval(input))
})

const members = async () => [{ team: 'sellers', id: '2' }, { team: 'agents', id: '1' }]
const input = { team: 'sellers', ownerId: '2', mode: 'times', start: '2090-01-03T10:00', end: '2090-01-03T11:00' }
test('blocks create owned Bigin events without participants and deduplicate identical intervals', async () => {
  let event
  const calls = []
  const request = async (path, method, body) => {
    calls.push({ path, method, body })
    if (method === 'POST') { event = { ...body.data[0], id: '123' }; return { data: [{ code: 'SUCCESS' }] } }
    return { data: event ? [event] : [] }
  }
  const blocks = await changeCalendarBlock(input, false, request, members)
  assert.equal(blocks[0].ownerId, '2')
  const create = calls.find(c => c.method === 'POST')
  assert.deepEqual(create.body.data[0].Participants, [])
  assert.deepEqual(create.body.trigger, [])
  assert.equal(create.body.data[0].Start_DateTime, '2090-01-03T15:00:00+00:00')
  await changeCalendarBlock(input, false, request, members)
  assert.equal(calls.filter(c => c.method === 'POST').length, 1)
  await assert.rejects(changeCalendarBlock({ ...input, team: 'agents', ownerId: '1' }, false, request, members), /assigned calendar member/)
})

test('removal cannot delete ordinary appointments or another owner’s blocks', async () => {
  for (const event of [{ Owner: { id: '2' }, Event_Title: 'Consultation' }, { Owner: { id: '3' }, Event_Title: 'Dharma calendar block', Description: 'Managed by Dharma Forms calendar blocking v1.' }]) {
    let deleted = false
    await assert.rejects(changeCalendarBlock({ ...input, id: '123' }, true, async (path, method) => { if (method === 'DELETE') deleted = true; return { data: [event] } }, members), /Only blocks/)
    assert.equal(deleted, false)
  }
})

test('list paginates, hides unrelated events, and allows deletion of a verified block', async () => {
  const event = { id: '123', Owner: { id: '2' }, Event_Title: 'Dharma calendar block', Description: 'Managed by Dharma Forms calendar blocking v1.', Start_DateTime: '2090-01-03T15:00:00Z', End_DateTime: '2090-01-03T16:00:00Z' }
  let page = 0
  assert.equal((await listCalendarBlocks(async () => ({ data: [page++ ? event : { ...event, Description: 'Not managed' }], info: { more_records: page === 1 } }), members)).length, 1)
  let deleted = false
  await changeCalendarBlock({ ...input, id: '123' }, true, async (path, method) => {
    if (method === 'DELETE') { assert.equal(path, 'Events/123'); deleted = true; return { data: [{ code: 'SUCCESS' }] } }
    return { data: deleted ? [] : [event] }
  }, members)
  assert.equal(deleted, true)
})

test('block searches use Bigin-compatible date precision and constrain the owner', async () => {
  await listCalendarBlocks(async path => {
    const criteria = new URLSearchParams(path.split('?')[1]).get('criteria')
    assert.match(criteria, /Owner:equals:2/)
    assert.match(criteria, /End_DateTime:greater_than:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00/)
    assert.doesNotMatch(criteria, /\.\d{3}Z/)
    return { data: [] }
  }, members)
})
