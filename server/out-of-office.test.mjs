import test from 'node:test'
import assert from 'node:assert/strict'
import { planOutOfOffice, extendOutOfOffice, lunchTimes } from './out-of-office.mjs'

const members = [{ team: 'sellers', id: '1' }, { team: 'customer-service', id: '2' }, { team: 'nutritionists', id: '3' }, { team: 'agents', id: '4' }]
test('daily lunches preserve the seven requested Eastern schedules over DST and exclude agent-only Zara', () => {
  const people = Object.keys(lunchTimes).map(id => ({ id, team: 'sellers' }))
  people.push({ id: '7692472000002530266', team: 'agents' })
  const existing = people.map(p => ({ ownerId: p.id, title: 'Out of office', start: '2027-11-20T19:00:00-05:00' }))
  const plan = planOutOfOffice(people, existing, new Date('2026-11-20T00:00:00-05:00'))
  assert.equal(plan.length, 7 * 366)
  assert.ok(plan.every(e => e.Event_Title === 'Lunch' && e.Owner.id !== '7692472000002530266'))
  const aliceWinter = plan.find(e => e.Owner.id === '7692472000002530221' && e.Start_DateTime.startsWith('2026-11-20'))
  const aliceSummer = plan.find(e => e.Owner.id === '7692472000002530221' && e.Start_DateTime.startsWith('2027-07-20'))
  assert.equal(aliceWinter.Start_DateTime, '2026-11-20T19:00:00+00:00')
  assert.equal(aliceSummer.Start_DateTime, '2027-07-20T18:00:00+00:00')
  const expectedDurations = { '7692472000002530221': 40, '7692472000002530213': 40, '7692472000002530199': 40, '7692472000002527291': 30, '7692472000002527266': 30, '7692472000002527203': 30, '7692472000002527252': 30 }
  for (const event of plan) assert.equal((Date.parse(event.End_DateTime) - Date.parse(event.Start_DateTime)) / 60000, expectedDurations[event.Owner.id])
})
test('out-of-office policy covers Sellers and CS every day and keeps Eastern hours across DST', () => {
  const plan = planOutOfOffice(members, [], new Date('2026-11-19T00:00:00-05:00'))
  assert.equal(plan.length, 366 * 2 * 2)
  assert.equal(planOutOfOffice([...members, { ...members[0], team: 'customer-service' }], [], new Date('2026-11-19T00:00:00-05:00')).length, plan.length)
  assert.deepEqual([...new Set(plan.map(e => e.Owner.id))], ['1', '2'])
  const winter = plan.find(e => e.Owner.id === '1' && e.Start_DateTime === '2026-11-19T05:00:00+00:00')
  const summer = plan.find(e => e.Owner.id === '1' && e.Start_DateTime === '2027-03-15T04:00:00+00:00')
  assert.equal(winter.End_DateTime, '2026-11-19T15:40:00+00:00')
  assert.equal(summer.End_DateTime, '2027-03-15T14:40:00+00:00')
})
test('extension appends new dates without recreating removed blocks inside existing coverage', () => {
  const existing = ['1', '2'].map(ownerId => ({ ownerId, title: 'Out of office', start: '2027-11-19T19:00:00-05:00' }))
  assert.equal(planOutOfOffice(members, existing, new Date('2026-11-19T10:00:00-05:00')).length, 0)
  const plan = planOutOfOffice(members, existing, new Date('2026-11-20T10:00:00-05:00'))
  assert.equal(plan.length, 4)
  assert.deepEqual([...new Set(plan.map(e => e.Start_DateTime))], ['2027-11-20T05:00:00+00:00', '2027-11-21T00:00:00+00:00'])
})
test('extension skips past blocks and checks every Bigin batch result', async () => {
  const plan = planOutOfOffice([members[0]], [], new Date('2026-11-19T12:00:00-05:00'))
  assert.equal(plan[0].Start_DateTime, '2026-11-20T00:00:00+00:00')
  await assert.rejects(extendOutOfOffice(async (path, method) => method === 'POST' ? { data: [{ code: 'INVALID_DATA' }] } : { data: [] }, async () => [members[0]], new Date('2026-11-19T12:00:00-05:00')), /needs review/)
})

test('extension verifies saved instants and corrects Bigin DST adjustments', async () => {
  const existing = ['1', '2'].map(ownerId => ({ id: ownerId, Event_Title: 'Out of office', Description: 'Managed by Dharma Forms calendar blocking v1.', Owner: { id: ownerId }, Start_DateTime: '2027-11-19T19:00:00-05:00', End_DateTime: '2027-11-20T00:00:00-05:00' }))
  const saved = new Map()
  let corrections = 0
  const request = async (path, method, body) => {
    if (path.includes('/search?')) return { data: existing }
    if (method === 'POST') return { data: body.data.map((event, index) => {
      const id = String(index + 10)
      saved.set(id, { ...event, End_DateTime: new Date(Date.parse(event.End_DateTime) + (index === 0 ? 3600000 : 0)).toISOString() })
      return { code: 'SUCCESS', details: { id } }
    }) }
    if (method === 'PUT') {
      const event = body.data[0]
      saved.set(event.id, { ...saved.get(event.id), ...event }); corrections++
      return { data: [{ code: 'SUCCESS' }] }
    }
    return { data: [saved.get(path.split('/')[1])] }
  }
  assert.equal(await extendOutOfOffice(request, async () => members, new Date('2026-11-20T10:00:00-05:00')), 4)
  assert.equal(corrections, 1)
})
