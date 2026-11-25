import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { biginRequest } from '../server/submissions.mjs'
import { csv, parseCsv } from '../src/migration.ts'

const inputs = process.argv.length > 2 ? process.argv.slice(2) : ['C:/Users/jeuzv/Downloads/new-leads-1 (2).csv', 'C:/Users/jeuzv/Downloads/new-leads-1 (1).csv']
const pipeline = process.env.REPAIR_PIPELINE || 'new-leads'
assert.ok(['new-leads', 'customer-service'].includes(pipeline))
const root = resolve(`.migration-local/failed-deal-contact-repair-2026-11-26-${pipeline}`)
await mkdir(root, { recursive: true })
const records: Record<string, string>[] = [], seen = new Set<string>()
let headers: string[] = [], sourceRows = 0
for (const file of inputs) {
  const [columns, ...rows] = parseCsv(await readFile(file, 'utf8'))
  if (headers.length) assert.deepEqual(columns, headers)
  headers = columns
  for (const row of rows) {
    sourceRows++
    const record = Object.fromEntries(columns.map((column, index) => [column, row[index]]))
    assert.match(record.Errors, /matching parent record.*Email/i)
    const key = JSON.stringify(row)
    if (!seen.has(key)) { seen.add(key); records.push(record) }
  }
}
const lower = (value: unknown) => String(value || '').trim().toLowerCase()
const digits = (value: unknown) => String(value || '').replace(/\D/g, '')
const escape = (value: string) => value.replace(/[\\(),]/g, char => '\\' + char)
const users = (await biginRequest('users?type=AllUsers')).users
const resolved = new Map<string, { id: string; email: string; action: string }>()
const ledgerFile = resolve(root, 'ledger.json')
let ledger: Record<string, any> = {}
try { ledger = JSON.parse(await readFile(ledgerFile, 'utf8')) } catch (error: any) { if (error.code !== 'ENOENT') throw error }
const persist = () => writeFile(ledgerFile, JSON.stringify(ledger, null, 2))
const audit: any[] = []
for (const record of records) {
  const phone = digits(record['Phone Number'])
  const requestedEmail = lower(record.Email) || (phone ? `${phone}@dummy.com` : '')
  assert.match(requestedEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  if (resolved.has(requestedEmail)) { record.Email = resolved.get(requestedEmail)!.email; continue }
  const criteria = `(Email:equals:${escape(requestedEmail)})${phone ? `or(Phone:equals:${phone})` : ''}`
  const response = await biginRequest(`Contacts/search?${new URLSearchParams({ criteria: phone ? `(${criteria})` : criteria, per_page: '200' })}`)
  if (response.info?.more_records) throw Error('Contact matches were truncated; stopped before creating a duplicate')
  // Bigin phone searches may also return similar numbers. Compare normalized
  // values before resolving identity or treating the result as ambiguous.
  let candidates = (response.data || []).filter((contact: any) => lower(contact.Email) === requestedEmail || (phone && digits(contact.Phone) === phone))
  // New contacts can take time to appear in CRM search. Reconcile our write
  // ledger using record reads rather than submitting another creation.
  if (ledger[requestedEmail]) {
    const prior = ledger[requestedEmail]
    const recent = prior.id
      ? (await biginRequest(`Contacts/${prior.id}`)).data || []
      : (await biginRequest('Contacts?fields=First_Name,Last_Name,Email,Phone,Owner&sort_by=id&sort_order=desc&per_page=200')).data || []
    const verified = recent.filter((contact: any) => lower(contact.Email) === requestedEmail)
    if (verified.length) candidates = verified
  }
  const exact = candidates.filter((contact: any) => lower(contact.Email) === requestedEmail)
  let contact: any, action: string
  if (exact.length === 1) { contact = exact[0]; action = 'existing-email' }
  else if (exact.length > 1 || candidates.length > 1) throw Error(`Ambiguous contact for failed row ${record['Row Number']}; manual review required`)
  else if (candidates.length === 1) {
    contact = candidates[0]
    if (lower(contact.Email)) { action = 'existing-phone-use-current-email' }
    else {
      const result = await biginRequest(`Contacts/${contact.id}`, 'PUT', { data: [{ id: contact.id, Email: requestedEmail }], trigger: [] })
      if (result.data?.[0]?.code !== 'SUCCESS') throw Error('Could not add the missing email to an existing contact')
      action = 'existing-phone-added-email'
    }
  } else {
    if (ledger[requestedEmail]?.status === 'pending') throw Error('Uncertain earlier creation; reconcile before retrying')
    const name = record['Deal Name'].replace(/^(?:sellers?|cs|nutri|new\s+sale)\s*[-–—:]\s*/i, '').trim() || `Client ${phone}`
    const owner = users.find((user: any) => lower(user.email) === lower(record['Deal Owner']) && user.status === 'active')
    if (!owner) throw Error(`Deal owner unavailable for failed row ${record['Row Number']}`)
    const payload = { Last_Name: name, Email: requestedEmail, ...(phone ? { Phone: phone } : {}), Owner: { id: owner.id } }
    ledger[requestedEmail] = { status: 'pending', payload }; await persist()
    const result = await biginRequest('Contacts', 'POST', { data: [payload], trigger: [] })
    const saved = result.data?.[0]
    if (saved?.code !== 'SUCCESS' || !saved.details?.id) { ledger[requestedEmail] = { status: 'rejected', code: saved?.code }; await persist(); throw Error('Contact creation was rejected') }
    contact = { id: saved.details.id }; action = 'created'
    ledger[requestedEmail] = { status: 'saved-unverified', id: contact.id }; await persist()
  }
  const fresh = (await biginRequest(`Contacts/${contact.id}`)).data?.[0]
  if (!fresh || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(fresh.Email))) throw Error('Contact email readback failed')
  if (action === 'created' && (lower(fresh.Email) !== requestedEmail || digits(fresh.Phone) !== phone)) throw Error('Created contact readback differs')
  const saved = { id: fresh.id, email: lower(fresh.Email), action }
  ledger[requestedEmail] = { status: 'verified', ...saved }; await persist()
  resolved.set(requestedEmail, saved); audit.push({ requestedEmail, ...saved })
  record.Email = saved.email
  console.log(JSON.stringify({ row: record['Row Number'], action }))
}
const retryHeaders = headers.filter(header => !['Row Number', 'Warnings', 'Errors'].includes(header))
const retryRows = records.map(record => retryHeaders.map(header => record[header] || ''))
assert.equal(retryRows.length, records.length)
const output = `C:/Users/jeuzv/Downloads/${pipeline}-retry-after-contact-repair.csv`
await writeFile(output, csv([retryHeaders, ...retryRows]))
await writeFile(resolve(root, 'retry.csv'), csv([retryHeaders, ...retryRows]))
const summary = { sourceRows, uniqueFailedDeals: records.length, duplicateRowsRemoved: sourceRows - records.length, contacts: audit.length, actions: audit.reduce((counts, row) => ({ ...counts, [row.action]: (counts[row.action] || 0) + 1 }), {} as Record<string, number>), output, completedAt: new Date().toISOString() }
await writeFile(resolve(root, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
