import test from 'node:test'
import assert from 'node:assert/strict'
import { addStageAuditNote, changeStageDealOwner, stageRecord, stageUpdate, stageLineTotal, searchStageClients, getStageClient, getStageProducts, updateStageDeal } from './stage.mjs'

const metadata = { pipelines: [{ id: '10', name: 'New Leads', stages: ['Unused global stage'], fields: [
  { api_name: 'Sub_Pipeline', pick_list_values: [{ actual_value: 'Old sub', display_value: 'Sales', maps: [{ api_name: 'Stage', pick_list_values: [{ actual_value: 'PAID' }, { actual_value: 'Waiting for Payment' }] }] }] },
  { api_name: 'Product', length: 255 }, { api_name: 'Payment_Notes', length: 255 }, { api_name: 'Payment_Method', pick_list_values: [{ actual_value: '-None-' }, { actual_value: 'Credit/Debit Card', display_value: 'Card' }] },
] }] }
const raw = { id: '20', Pipeline: { id: '10', name: 'New Leads' }, Sub_Pipeline: 'Sales', Stage: 'Waiting for Payment', Contact_Name: { id: '30' }, Modified_Time: '2026-11-20T10:00:00Z', Created_Time: '2026-11-19T09:00:00Z', Amount: 100, Installments: 6, Total_Amount_Payable: 106, Payment_Notes: 'Existing note', Payment_Method: 'Credit/Debit Card', Product: 'Existing product; Manual entry', Associated_Products: [{ id: '40', Product: { id: '50', name: 'Existing product' }, List_Price: 100, Quantity: 1, Discount: 10, Total: 90 }] }
const catalog = [{ id: '60', name: 'New product', price: 50 }]
const input = () => ({ id: '20', contactId: '30', version: raw.Modified_Time, stage: 'PAID', paymentNotes: 'Updated payment note', paymentMethod: 'Credit/Debit Card', installments: '12.50', addProducts: [{ id: '60', quantity: '2', price: '45.00' }], Total_Amount_Payable: 999, Amount: 999 })

test('percentage discounts are carried to Bigin and line totals round fractional quantities to cents', () => {
  const payload = stageUpdate({ ...input(), addProducts: [{ id: '60', price: '45.00', quantity: '2', discount: '10' }] }, stageRecord(raw, metadata), catalog)
  assert.equal(payload.Associated_Products[0].Discount, 10)
  assert.equal(stageLineTotal('45.00', '2', '10'), 81)
  assert.equal(stageLineTotal('19.99', '1.5', '12.5'), 26.24)
  assert.equal(stageLineTotal('0.05', '1', '50'), 0.03)
  assert.equal(stageLineTotal('45', '2', '100'), 0)
  for (const discount of ['-1', '100.01', 'abc', '0.001', Infinity]) assert.throws(() => stageUpdate({ ...input(), addProducts: [{ id: '60', price: '45', quantity: '2', discount }] }, stageRecord(raw, metadata), catalog), /discounts must/)
})

test('deal metadata follows its sub-pipeline stage map, exposes totals, and rejects truncated products', () => {
  const d = stageRecord(raw, metadata)
  assert.deepEqual(d.allowedStages, ['PAID', 'Waiting for Payment'])
  assert.equal(d.totalPayable, 106)
  assert.equal(d.createdTime, raw.Created_Time)
  assert.equal(d.products[0].discount, 10)
  assert.throws(() => stageRecord({ ...raw, $has_more: { Associated_Products: true } }, metadata), /preserve all rows/)
})

test('evaluation dates are exposed in deal details and client cards, including empty dates', async () => {
  const evaluation = '2026-11-25T14:30:00-05:00'
  assert.equal(stageRecord({ ...raw, Evaluation_date_and_hour: evaluation }, metadata).evaluationTime, evaluation)
  assert.equal(stageRecord(raw, metadata).evaluationTime, null)
  const result = await getStageClient('30', async path => {
    if (path === 'Contacts/30') return { data: [{ id: '30' }] }
    assert.ok(new URLSearchParams(path.split('?')[1]).get('fields').split(',').includes('Evaluation_date_and_hour'))
    return { data: [{ ...raw, Evaluation_date_and_hour: evaluation }, { ...raw, id: '21' }] }
  })
  assert.equal(result.deals[0].evaluationTime, evaluation)
  assert.equal(result.deals[1].evaluationTime, null)
})

test('product additions append verified catalog identities, synchronize Other Info, and carry forward only the CRM Amount', () => {
  const payload = stageUpdate(input(), stageRecord(raw, metadata), catalog)
  assert.deepEqual(payload.Associated_Products, [{ Product: { id: '60' }, List_Price: 45, Quantity: 2, Discount: 0 }])
  assert.equal(payload.Product, 'Existing product, Manual entry, New product')
  assert.equal(payload.Installments, 12.5)
  assert.equal(payload.Amount, 100)
  for (const field of ['Total_Amount_Payable', 'Owner', 'Contact_Name']) assert.equal(field in payload, false)
  assert.equal(payload.Associated_Products.some(p => p.id === '40'), false)
})

test('ordinary stage/payment edits leave existing product rows and free-text product data untouched', () => {
  const payload = stageUpdate({ ...input(), addProducts: [] }, stageRecord(raw, metadata), catalog)
  assert.equal('Associated_Products' in payload, false)
  assert.equal('Product' in payload, false)
  assert.equal('Amount' in payload, false)
})

test('an unchanged historical payment method is preserved without resending an obsolete picklist choice', () => {
  const current = { ...stageRecord(raw, metadata), paymentMethod: 'Legacy payment method' }
  const payload = stageUpdate({ ...input(), paymentMethod: current.paymentMethod, addProducts: [] }, current, catalog)
  assert.equal('Payment_Method' in payload, false)
})

test('stale versions, contact mismatch, invalid stage/method, financial values and unknown/duplicate products fail before writes', () => {
  const current = stageRecord(raw, metadata)
  for (const change of [
    { version: 'stale' }, { contactId: '999' }, { stage: 'Unused global stage' }, { paymentMethod: 'Made up' }, { installments: '-1' }, { installments: '1.001' }, { paymentNotes: 'x'.repeat(256) },
    { addProducts: [{ id: '50', price: 10, quantity: 1 }] }, { addProducts: [{ id: '999', price: 10, quantity: 1 }] }, { addProducts: [{ id: '60', price: -10, quantity: 1 }] }, { addProducts: [{ id: '60', price: 10, quantity: 0 }] },
    { addProducts: [{ id: '60', price: 10, quantity: 1 }, { id: '60', price: 10, quantity: 1 }] },
  ]) assert.throws(() => stageUpdate({ ...input(), ...change }, current, catalog))
  assert.throws(() => stageUpdate(input(), { ...current, productTextMax: 5 }, catalog), /only 5 characters/)
})

test('client search safely encodes names, emails, phones and criterion characters as word queries', async () => {
  let path
  const result = await searchStageClients('Alice (test)@example.com', async p => { path = p; return { data: [{ id: '30', First_Name: 'Alice', Last_Name: 'Test', Email: 'alice@example.com', secret: 'hidden' }], info: { more_records: true } } })
  const params = new URLSearchParams(path.split('?')[1])
  assert.equal(params.get('word'), 'Alice (test)@example.com')
  assert.equal(params.has('criteria'), false)
  assert.equal(result.more, true)
  assert.equal(result.clients[0].name, 'Alice Test')
  assert.equal('secret' in result.clients[0], false)
  await assert.rejects(searchStageClients('a'), /at least two/)
})

test('client detail paginates related deals and product catalog excludes inactive products', async () => {
  let page = 0
  const result = await getStageClient('30', async path => path === 'Contacts/30' ? { data: [{ id: '30', Full_Name: 'Client' }] } : { data: [{ id: String(++page), Pipeline: { name: page === 1 ? 'New Leads' : 'Customer Service' } }], info: { more_records: page === 1 } })
  assert.equal(result.deals.length, 2)
  const products = await getStageProducts(async () => ({ data: [{ id: '1', Product_Name: 'Active', Unit_Price: 0, Product_Active: true }, { id: '2', Product_Name: 'Inactive', Product_Active: false }] }))
  assert.deepEqual(products, [{ id: '1', name: 'Active', price: 0 }])
})

test('save verifies Bigin readback and never sends client-supplied totals or contact/owner changes', async () => {
  let record = structuredClone(raw)
  let writes = 0
  const request = async (path, method, body) => {
    if (method === 'PUT') {
      writes++
      assert.deepEqual(body.trigger, [])
      const update = body.data[0]
      const newLine = update.Associated_Products[0]
      record = { ...record, ...update, Amount: update.Amount + 90, Associated_Products: [...raw.Associated_Products, { ...newLine, Product: { id: '60', name: 'New product' }, Total: 90 }], Modified_Time: '2026-11-20T10:01:00Z', Total_Amount_Payable: 202.5 }
      return { data: [{ code: 'SUCCESS' }] }
    }
    return { data: [record] }
  }
  const result = await updateStageDeal(input(), request, async () => metadata, async () => catalog)
  assert.equal(result.totalPayable, 202.5)
  assert.equal(result.products.length, 2)
  assert.equal(writes, 1)
  await assert.rejects(updateStageDeal(input(), request, async () => metadata, async () => catalog), /already paid/)
  assert.equal(writes, 1)
})


test('paid deals remain in client results but reject updates before any write', async () => {
  const result = await getStageClient('30', async path => path === 'Contacts/30'
    ? { data: [{ id: '30', Full_Name: 'Client' }] }
    : { data: [{ ...raw, Stage: 'PAID' }, { ...raw, id: '21' }] })
  assert.equal(result.deals.length, 2)
  assert.equal(result.deals[0].paid, true)
  assert.equal(result.deals[0].createdTime, raw.Created_Time)
  assert.equal(result.deals[1].paid, false)
  for (const stage of ['PAID', 'Paid', ' paid ']) {
    const record = { ...raw, Stage: stage }
    assert.equal(stageRecord(record, metadata).paid, true)
    await assert.rejects(updateStageDeal(input(), async (path, method) => {
      assert.notEqual(method, 'PUT')
      return { data: [record] }
    }, async () => metadata, async () => catalog), /already paid/)
  }
})


test('ownership changes write only the deal owner and verify Bigin readback', async () => {
  let record = { ...raw, Owner: { id: '70', name: 'Original' } }
  let writes = 0
  const updated = await changeStageDealOwner({ ...input(), ownerId: '80', stage: 'PAID' }, async (path, method, body) => {
    if (method === 'PUT') {
      writes++
      assert.deepEqual(body, { data: [{ id: '20', Owner: { id: '80' } }], trigger: [] })
      record = { ...record, Owner: { id: '80', name: 'New owner' } }
      return { data: [{ code: 'SUCCESS' }] }
    }
    return { data: [record] }
  }, async () => metadata, async () => [{ id: '80', name: 'New owner' }])
  assert.equal(writes, 1)
  assert.equal(updated.owner.id, '80')
  assert.equal(updated.stage, raw.Stage)
})

test('ownership changes reject paid deals, stale records, unrelated contacts and inactive owners before writes', async () => {
  for (const [recordChange, inputChange, error] of [
    [{ Stage: 'PAID' }, {}, /already paid/],
    [{}, { version: 'stale' }, /changed since/],
    [{}, { contactId: '99' }, /does not belong/],
    [{}, { ownerId: '99' }, /active Bigin user/],
  ]) {
    await assert.rejects(changeStageDealOwner({ ...input(), ownerId: '80', ...inputChange }, async (path, method) => {
      assert.notEqual(method, 'PUT')
      return { data: [{ ...raw, ...recordChange }] }
    }, async () => metadata, async () => [{ id: '80' }]), error)
  }
})


test('marking a deal paid stamps the server save date in US Eastern time (EST/EDT), ignoring browser dates and prior values', () => {
  const current = { ...stageRecord(raw, metadata), paidDate: '2020-01-01' }
  const payload = stageUpdate({ ...input(), Paid_Date: '1999-01-01', paidDate: '1999-01-01' }, current, catalog, new Date('2026-11-21T05:00:00Z'))
  assert.equal(payload.Paid_Date, '2026-11-21')
  const beforeMidnight = stageUpdate(input(), current, catalog, new Date('2026-11-21T04:59:59Z'))
  assert.equal(beforeMidnight.Paid_Date, '2026-11-20')
  const summer = stageUpdate(input(), current, catalog, new Date('2026-07-21T04:30:00Z'))
  assert.equal(summer.Paid_Date, '2026-07-21')
  const summerBeforeMidnight = stageUpdate(input(), current, catalog, new Date('2026-07-21T03:59:59Z'))
  assert.equal(summerBeforeMidnight.Paid_Date, '2026-07-20')
  const ordinary = stageUpdate({ ...input(), stage: raw.Stage }, current, catalog)
  assert.equal('Paid_Date' in ordinary, false)
  assert.equal(stageRecord({ ...raw, Paid_Date: payload.Paid_Date }, metadata).paidDate, '2026-11-21')
})

test('save reports a paid date readback mismatch instead of confirming an incomplete paid update', async () => {
  let record = structuredClone(raw)
  await assert.rejects(updateStageDeal({ ...input(), addProducts: [] }, async (path, method, body) => {
    if (method === 'PUT') {
      assert.match(body.data[0].Paid_Date, /^\d{4}-\d{2}-\d{2}$/)
      const { Paid_Date, ...other } = body.data[0]
      record = { ...record, ...other }
      return { data: [{ code: 'SUCCESS' }] }
    }
    return { data: [record] }
  }, async () => metadata, async () => catalog), /Paid Date differs/)
})


test('audit notes identify the authenticated staff account and describe actual changes in Eastern time', async () => {
  const before = stageRecord({ ...raw, Owner: { id: '70', name: 'Original owner' } }, metadata)
  const after = { ...before, stage: 'PAID', paidDate: '2026-11-21', owner: { id: '80', name: 'New owner' } }
  let notes = 0
  const warning = await addStageAuditNote(before, after, { id: 'staff-auth-id', email: 'staff@example.com' }, async (path, method, body) => {
    notes++
    assert.equal(path, 'Pipelines/20/Notes')
    assert.equal(method, 'POST')
    assert.equal(body.data[0].Note_Title, 'Updated by: staff@example.com')
    assert.match(body.data[0].Note_Content, /Stage: Waiting for Payment -> PAID/)
    assert.match(body.data[0].Note_Content, /Ownership: Original owner -> New owner/)
    assert.doesNotMatch(body.data[0].Note_Content, /Time zone:|Edited by:|WHAT CHANGED/)
    assert.match(body.data[0].Note_Content, /\nCHANGES\n/)
    assert.match(body.data[0].Note_Content, /EST/)
    assert.match(body.data[0].Note_Content, /Deal ID: 20/)
    assert.match(body.data[0].Note_Content, /Deal created: November 19, 2026/)
    assert.match(body.data[0].Note_Content, /Deal edited: November 21, 2026/)
    assert.doesNotMatch(body.data[0].Note_Content, /Products:/)
    return { data: [{ code: 'SUCCESS' }] }
  }, new Date('2026-11-21T15:30:00Z'))
  assert.equal(warning, null)
  assert.equal(notes, 1)
  assert.equal(await addStageAuditNote(before, before, {}, async () => assert.fail('No note for no change')), null)
})

test('audit note failures report that the deal save already succeeded', async () => {
  const before = stageRecord(raw, metadata)
  const warning = await addStageAuditNote(before, { ...before, stage: 'PAID' }, { id: 'staff', email: 'staff@example.com' }, async () => { throw new Error('Scope mismatch') })
  assert.match(warning, /changes were saved/)
  assert.match(warning, /Do not repeat/)
})


test('audit notes label product changes as Product input and omit unchanged fields', async () => {
  const before = stageRecord({ ...raw, Deal_Name: 'Sellers - Client', Owner: { id: '70', name: 'Carlos' } }, metadata)
  for (const products of [
    [...before.products, { id: '60', name: 'New product', price: 10, quantity: 1 }],
    before.products.map(product => ({ ...product, price: 200 })),
  ]) {
    assert.equal(await addStageAuditNote(before, { ...before, products }, { id: 'staff', email: 'staff@example.com' }, async (path, method, body) => {
      const note = body.data[0]
      assert.equal(note.Note_Title, 'Updated by: staff@example.com')
      assert.match(note.Note_Content, /Deal: Sellers - Client/)
      assert.match(note.Note_Content, /Products: Product input/)
      assert.doesNotMatch(note.Note_Content, /Stage:|Ownership:/)
      return { data: [{ code: 'SUCCESS' }] }
    }, new Date('2026-07-21T15:00:00Z')), null)
  }
})


test('ownership-only notes omit stage, products, and unchanged payment details', async () => {
  const before = stageRecord({ ...raw, Owner: { id: '70', name: 'Carlos' } }, metadata)
  const after = { ...before, owner: { id: '80', name: 'Ana' } }
  assert.equal(await addStageAuditNote(before, after, { id: 'staff', email: 'staff@example.com' }, async (path, method, body) => {
    const note = body.data[0]
    assert.equal(note.Note_Title, 'Updated by: staff@example.com')
    assert.match(note.Note_Content, /Ownership: Carlos -> Ana/)
    assert.match(note.Note_Content, /Deal created:/)
    assert.match(note.Note_Content, /Deal edited:/)
    assert.doesNotMatch(note.Note_Content, /Stage:|Products:|Payment notes:|Installments:|Unchanged|No changes/)
    return { data: [{ code: 'SUCCESS' }] }
  }), null)
})
