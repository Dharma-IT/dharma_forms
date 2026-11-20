import { biginRequest, getFormMetadata } from './submissions.mjs'
import { getBiginUsers } from './teams.mjs'

const pending = new Set()
const isPaidStage = stage => typeof stage === 'string' && stage.trim().toUpperCase() === 'PAID'
const assertId = id => { if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new Error('Select a valid CRM record.') }
const choices = field => (field?.pick_list_values || []).filter(v => v.actual_value && v.actual_value !== '-None-').map(v => ({ value: v.actual_value, label: v.display_value || v.actual_value }))

export function stageLineTotal(price, quantity, discount = 0) {
  // All inputs are validated to two decimals before calling. Integer arithmetic
  // keeps percentage discounts and fractional quantities rounded to cents.
  const scaled = value => BigInt(String(value).split('.')[0]) * 100n + BigInt((String(value).split('.')[1] || '').padEnd(2, '0'))
  const numerator = scaled(price) * scaled(quantity) * (10000n - scaled(discount))
  return Number((numerator + 500000n) / 1000000n) / 100
}

export async function getStageProducts(request = biginRequest) {
  const products = []
  for (let page = 1; ; page++) {
    const result = await request(`Products?${new URLSearchParams({ fields: 'Product_Name,Unit_Price,Product_Active', page: String(page), per_page: '200' })}`)
    for (const p of result.data || []) if (p.Product_Active !== false) products.push({ id: p.id, name: p.Product_Name, price: Number(p.Unit_Price || 0) })
    if (!result.info?.more_records) break
  }
  return products.sort((a, b) => a.name.localeCompare(b.name))
}

export async function searchStageClients(query, request = biginRequest) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) throw new Error('Enter at least two characters of a name, email, or phone number.')
  const result = await request(`Contacts/search?${new URLSearchParams({ word: query.trim(), per_page: '50' })}`)
  return { clients: (result.data || []).map(c => ({ id: c.id, name: c.Full_Name || [c.First_Name, c.Last_Name].filter(Boolean).join(' '), email: c.Email || '', phone: c.Phone || c.Mobile || '' })), more: Boolean(result.info?.more_records) }
}

export async function getStageClient(id, request = biginRequest) {
  assertId(id)
  const result = await request(`Contacts/${id}`)
  const c = result.data?.[0]
  if (!c) throw new Error('This client no longer exists.')
  const deals = []
  for (let page = 1; ; page++) {
    const result = await request(`Contacts/${id}/Pipelines?${new URLSearchParams({ fields: 'Deal_Name,Pipeline,Stage,Amount,Modified_Time,Paid_Date,Created_Time,Owner', per_page: '200', page: String(page) })}`)
    for (const d of result.data || []) if (['New Leads', 'Customer Service'].includes(d.Pipeline?.name)) deals.push({ id: d.id, name: d.Deal_Name, pipeline: d.Pipeline.name, stage: d.Stage, paid: isPaidStage(d.Stage), paidDate: d.Paid_Date || null, createdTime: d.Created_Time || null, owner: { id: d.Owner?.id || '', name: d.Owner?.name || '' }, amount: d.Amount, modified: d.Modified_Time })
    if (!result.info?.more_records) break
  }
  return { client: { id: c.id, name: c.Full_Name || [c.First_Name, c.Last_Name].filter(Boolean).join(' '), email: c.Email || '', phone: c.Phone || c.Mobile || '' }, deals }
}

export function stageRecord(raw, metadata) {
  const pipeline = metadata.pipelines.find(p => p.id === raw.Pipeline?.id)
  if (!pipeline) throw new Error('This deal is outside the supported pipelines.')
  if (raw.$has_more?.Associated_Products) throw new Error('This deal has more product rows than the CRM returned. Edit it directly in Bigin to preserve all rows.')
  const sub = pipeline.fields.find(f => f.api_name === 'Sub_Pipeline')?.pick_list_values?.find(v => v.actual_value === raw.Sub_Pipeline || v.display_value === raw.Sub_Pipeline)
  const mapped = sub?.maps?.find(m => m.api_name === 'Stage')?.pick_list_values?.map(v => v.actual_value) || pipeline.stages
  const field = api => pipeline.fields.find(f => f.api_name === api)
  return {
    id: raw.id, contactId: raw.Contact_Name?.id, name: raw.Deal_Name, pipeline: pipeline.name, version: raw.Modified_Time,
    owner: { id: raw.Owner?.id || '', name: raw.Owner?.name || '' },
    stage: raw.Stage, paid: isPaidStage(raw.Stage), stages: [...new Set([raw.Stage, ...mapped].filter(Boolean))], allowedStages: mapped,
    paymentNotes: raw.Payment_Notes || '', paymentNotesMax: field('Payment_Notes')?.length || 255,
    paymentMethod: raw.Payment_Method === '-None-' ? '' : raw.Payment_Method || '', paymentMethods: choices(field('Payment_Method')),
    installments: raw.Installments ?? 0, amount: raw.Amount ?? 0, totalPayable: raw.Total_Amount_Payable ?? null,
    paidDate: raw.Paid_Date || null, createdTime: raw.Created_Time || null,
    productText: raw.Product || '', productTextMax: field('Product')?.length || 255,
    products: (raw.Associated_Products || []).map(p => ({ rowId: p.id, id: p.Product?.id, name: p.Product?.name || p.Product?.Product_Name || '', price: p.List_Price ?? 0, quantity: p.Quantity ?? 1, discount: p.Discount ?? 0, total: p.Total ?? 0 })),
  }
}

export async function getStageDeal(id, request = biginRequest, loadMetadata = getFormMetadata) {
  assertId(id)
  const [result, metadata] = await Promise.all([request(`Pipelines/${id}`), loadMetadata(request)])
  if (!result.data?.[0]) throw new Error('This deal no longer exists.')
  const record = stageRecord(result.data[0], metadata)
  // Internal validation-only fields need not be exposed to the browser.
  const { allowedStages, ...deal } = record
  void allowedStages
  return deal
}

export function stageUpdate(input, current, products, now = new Date()) {
  if (isPaidStage(current.stage)) throw new Error('This deal is already paid and can no longer be selected or edited.')
  if (typeof input.version !== 'string' || input.version !== current.version) throw new Error('This deal changed since it was opened. Reload it before saving.')
  if (input.contactId !== current.contactId) throw new Error('The selected deal does not belong to this client.')
  if (typeof input.stage !== 'string' || (input.stage !== current.stage && !current.allowedStages.includes(input.stage))) throw new Error('Select a stage available in this deal’s sub-pipeline.')
  if (typeof input.paymentNotes !== 'string' || input.paymentNotes.length > current.paymentNotesMax) throw new Error(`Payment notes must be ${current.paymentNotesMax} characters or fewer.`)
  if (typeof input.paymentMethod !== 'string' || (input.paymentMethod !== current.paymentMethod && input.paymentMethod && !current.paymentMethods.some(v => v.value === input.paymentMethod))) throw new Error('Select a valid CRM payment method.')
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(input.installments))) throw new Error('Enter a nonnegative installment amount with at most two decimals.')
  if (!Array.isArray(input.addProducts) || input.addProducts.length > 30) throw new Error('Add at most 30 products per save.')
  const ids = new Set(current.products.map(p => p.id))
  const additions = input.addProducts.map(row => {
    const product = products.find(p => p.id === row.id)
    if (!product || ids.has(row.id)) throw new Error('Select active CRM products that are not already associated with this deal.')
    ids.add(row.id)
    if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0 || Number(row.quantity) > 10000 || !/^\d+(?:\.\d{1,2})?$/.test(String(row.quantity))) throw new Error('Product quantities must be positive, with at most two decimals.')
    if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(row.price))) throw new Error('Enter a nonnegative product price with at most two decimals.')
    const discount = row.discount ?? 0
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(discount)) || Number(discount) < 0 || Number(discount) > 100) throw new Error('Product discounts must be between 0 and 100 percent, with at most two decimals.')
    return { product, Quantity: Number(row.quantity), List_Price: Number(row.price), Discount: Number(discount) }
  })
  const payload = { id: current.id, Payment_Notes: input.paymentNotes, Installments: Number(input.installments) }
  if (input.stage !== current.stage) payload.Stage = input.stage
  if (isPaidStage(input.stage)) {
    // US Eastern time follows EST or EDT automatically.
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const part = type => parts.find(value => value.type === type).value
    payload.Paid_Date = `${part('year')}-${part('month')}-${part('day')}`
  }
  if (input.paymentMethod !== current.paymentMethod) payload.Payment_Method = input.paymentMethod || null
  if (additions.length) {
    // New rows append without resending old rows or discounts. Bigin computes
    // Amount as the submitted base plus submitted product totals, so preserve
    // the current CRM Amount as the base (never trust a browser-supplied base).
    payload.Associated_Products = additions.map(p => ({ Product: { id: p.product.id }, Quantity: p.Quantity, List_Price: p.List_Price, Discount: p.Discount }))
    if (!Number.isFinite(Number(current.amount))) throw new Error('The current CRM amount is invalid. Review the deal in Bigin.')
    payload.Amount = Number(current.amount)
    let text = current.productText.trim().replace(/;\s*/g, ', ')
    for (const name of [...current.products.map(p => p.name), ...additions.map(p => p.product.name)].filter(Boolean)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`(?:^|,\\s*)${escaped}(?:\\s*,|$)`, 'i').test(text)) text += `${text ? ', ' : ''}${name}`
    }
    if (text.length > current.productTextMax) throw new Error(`The CRM Other Info Product field allows only ${current.productTextMax} characters. Shorten its existing text in Bigin before adding more products.`)
    payload.Product = text
  }
  return payload
}

export async function updateStageDeal(input, request = biginRequest, loadMetadata = getFormMetadata, loadProducts = getStageProducts) {
  assertId(input.id)
  if (pending.has(input.id)) throw new Error('This deal is already being saved. Wait, then reload it.')
  pending.add(input.id)
  try {
    const [result, metadata, products] = await Promise.all([request(`Pipelines/${input.id}`), loadMetadata(request), loadProducts(request)])
    if (!result.data?.[0]) throw new Error('This deal no longer exists.')
    const current = stageRecord(result.data[0], metadata)
    const payload = stageUpdate(input, current, products)
    const saved = await request('Pipelines', 'PUT', { data: [payload], trigger: [] })
    if (saved.data?.[0]?.code !== 'SUCCESS') throw new Error('Bigin did not confirm this update. Reload the deal before retrying.')
    const fresh = await getStageDeal(input.id, request, async () => metadata)
    if (payload.Paid_Date && fresh.paidDate !== payload.Paid_Date) throw new Error('Bigin saved the record but the Paid Date differs. Review the deal in Bigin before retrying.')
    if (fresh.stage !== input.stage || fresh.paymentNotes !== input.paymentNotes || fresh.paymentMethod !== input.paymentMethod || Number(fresh.installments) !== Number(input.installments) || (payload.Product && fresh.productText !== payload.Product) || input.addProducts.some(p => !fresh.products.some(row => row.id === p.id))) throw new Error('Bigin saved the record but some values differ. Reload it and review before retrying.')
    if (input.addProducts.length) {
      const expected = Math.round(Number(current.amount) * 100) + input.addProducts.reduce((sum, p) => sum + Math.round(stageLineTotal(p.price, p.quantity, p.discount ?? 0) * 100), 0)
      if (Math.round(Number(fresh.amount) * 100) !== expected || current.products.some(p => !fresh.products.some(row => row.rowId === p.rowId && row.id === p.id && Number(row.price) === Number(p.price) && Number(row.quantity) === Number(p.quantity) && Number(row.discount) === Number(p.discount))) || input.addProducts.some(p => !fresh.products.some(row => row.id === p.id && Number(row.price) === Number(p.price) && Number(row.quantity) === Number(p.quantity) && Number(row.discount) === Number(p.discount ?? 0)))) throw new Error('Bigin saved unexpected product totals or changed an existing row. Reload the record and review it before retrying.')
    }
    return fresh
  } finally { pending.delete(input.id) }
}

export async function changeStageDealOwner(input, request = biginRequest, loadMetadata = getFormMetadata, loadUsers = getBiginUsers) {
  assertId(input.id)
  assertId(input.ownerId)
  if (pending.has(input.id)) throw new Error('This deal is already being saved. Wait, then reload it.')
  pending.add(input.id)
  try {
    const [current, users] = await Promise.all([getStageDeal(input.id, request, loadMetadata), loadUsers(request)])
    if (current.paid) throw new Error('This deal is already paid and its owner cannot be changed.')
    if (input.contactId !== current.contactId) throw new Error('The selected deal does not belong to this client.')
    if (typeof input.version !== 'string' || input.version !== current.version) throw new Error('This deal changed since it was opened. Reload it before changing its owner.')
    if (!users.some(user => user.id === input.ownerId)) throw new Error('Select an active Bigin user.')
    const saved = await request('Pipelines', 'PUT', { data: [{ id: input.id, Owner: { id: input.ownerId } }], trigger: [] })
    if (saved.data?.[0]?.code !== 'SUCCESS') throw new Error('Bigin did not confirm the owner change. Reload the deal before retrying.')
    const fresh = await getStageDeal(input.id, request, loadMetadata)
    if (fresh.owner.id !== input.ownerId) throw new Error('Bigin returned a different owner. Reload the deal and review before retrying.')
    return fresh
  } finally { pending.delete(input.id) }
}
