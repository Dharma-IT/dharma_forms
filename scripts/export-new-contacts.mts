import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { biginRequest } from '../server/submissions.mjs'
import { canonicalPerson, csv } from '../src/migration.ts'

const root = resolve(process.env.MIGRATION_ROOT || '.migration-local/incremental-2026-11-17')
const start = Date.parse('2026-11-17T00:00:00-05:00'), cutoff = Date.now()
const cache = resolve(root, 'new-contacts')
await mkdir(cache, { recursive: true })
async function hub(path: string, body?: any): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch('https://api.hubapi.com' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
    if (response.ok) return response.json()
    if (response.status !== 429 && response.status < 500) throw Error(`HubSpot HTTP ${response.status}`)
    await new Promise(done => setTimeout(done, 1500 * (attempt + 1)))
  }
  throw Error('HubSpot retries exhausted')
}
const source: any[] = []
async function load(low: number, high: number) {
  const filterGroups = [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(low) }, { propertyName: 'createdate', operator: 'LT', value: String(high) }] }]
  const properties = ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'hubspot_owner_id', 'createdate']
  let page = await hub('/crm/v3/objects/contacts/search', { filterGroups, properties, limit: 200 })
  if (page.total > 9000) { const mid = Math.floor((low + high) / 2); if (mid === low) throw Error('Contact range too dense'); await load(low, mid); await load(mid, high); return }
  for (;;) {
    source.push(...page.results)
    if (!page.paging?.next?.after) break
    await new Promise(done => setTimeout(done, 300))
    page = await hub('/crm/v3/objects/contacts/search', { filterGroups, properties, limit: 200, after: page.paging.next.after })
  }
}
await load(start, cutoff)
assert.equal(new Set(source.map(contact => contact.id)).size, source.length)
await writeFile(resolve(cache, 'source.json'), JSON.stringify(source))
console.log(JSON.stringify({ phase: 'source-contacts', contacts: source.length }))
const digits = (value: unknown) => String(value || '').replace(/\D/g, '')
const email = (value: unknown) => String(value || '').trim().toLowerCase()
const prepared = source.map(contact => {
  const p = contact.properties, phone = digits(p.phone) || digits(p.mobilephone)
  const real = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(p.email)) && !/@dummy\.com$/i.test(email(p.email))
  return { id: contact.id, p, phone, real, email: real ? email(p.email) : phone ? `${phone}@dummy.com` : `hubspot-${contact.id}@dummy.com` }
})
const escape = (value: string) => value.replace(/[\\(),]/g, char => '\\' + char)
const criteria = [...new Set(prepared.flatMap(contact => [
  `(Email:equals:${escape(contact.email)})`,
  ...(contact.phone ? [`(Phone:equals:${contact.phone})`, `(Email:equals:${contact.phone}@dummy.com)`] : []),
]))]
const target = new Map<string, any>()
let offset = 0, checked = 0
async function worker() {
  for (;;) {
    const from = offset; offset += 10
    if (from >= criteria.length) return
    const query = criteria.slice(from, from + 10).reduce((a, b) => `(${a}or${b})`)
    for (let page = 1; ; page++) {
      let result: any
      for (let attempt = 0; ; attempt++) {
        try { result = await biginRequest(`Contacts/search?${new URLSearchParams({ criteria: query, per_page: '200', page: String(page) })}`); break }
        catch (error) { if (attempt >= 3) throw error; await new Promise(done => setTimeout(done, 1500 * (attempt + 1))) }
      }
      await writeFile(resolve(cache, `search-${from}-${page}.json`), JSON.stringify(result))
      for (const contact of result.data || []) target.set(contact.id, contact)
      if (!result.info?.more_records) break
      if (page === 10) throw Error('Contact search truncated; no export produced')
    }
    checked += Math.min(10, criteria.length - from)
    if (checked % 500 === 0) console.log(JSON.stringify({ phase: 'checking-existing-contacts', checked, criteria: criteria.length }))
  }
}
await Promise.all([worker(), worker(), worker(), worker()])
const knownEmails = new Set([...target.values()].map(contact => email(contact.Email)).filter(Boolean))
const knownPhones = new Set([...target.values()].flatMap(contact => [digits(contact.Phone), digits(contact.Mobile), /^\d+@dummy\.com$/i.test(contact.Email || '') ? contact.Email.split('@')[0] : '']).filter(Boolean))
const owners: any[] = []
for (const archived of ['false', 'true']) {
  let after = ''
  do { const response = await hub(`/crm/v3/owners?${new URLSearchParams({ limit: '100', archived, ...(after ? { after } : {}) })}`); owners.push(...response.results); after = response.paging?.next?.after || '' } while (after)
}
const users = (await biginRequest('users?type=AllUsers')).users.filter((user: any) => user.status === 'active' && user.confirm !== false)
const fallback = users.find((user: any) => email(user.email) === 'ca@dharmanutritionclinic.com')
if (!fallback) throw Error('Fallback contact owner unavailable')
const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Contact Owner']
const ready: string[][] = [], audit: string[][] = [], review: string[][] = []
const seenEmails = new Set<string>(), seenPhones = new Set<string>()
let existing = 0, repeated = 0, realEmails = 0, dummyEmails = 0
for (const contact of prepared) {
  const p = contact.p
  let reason = ''
  if (knownEmails.has(contact.email) || (contact.phone && knownPhones.has(contact.phone))) { existing++; reason = 'Existing Bigin email or phone; excluded to preserve the existing contact' }
  else if (seenEmails.has(contact.email) || (contact.phone && seenPhones.has(contact.phone))) { repeated++; reason = 'Repeated source email or phone; compare before creating another contact' }
  if (reason) { review.push([contact.id, p.firstname || '', p.lastname || '', contact.email, contact.phone, reason]); continue }
  let first = String(p.firstname || '').trim(), last = String(p.lastname || '').trim()
  if (!last) { last = first || `Client ${contact.phone || contact.id}`; first = '' }
  const original = owners.find(owner => owner.id === p.hubspot_owner_id)
  let matches = original ? users.filter((user: any) => email(user.email) === email(original.email)) : []
  if (!matches.length && original) matches = users.filter((user: any) => canonicalPerson(user.full_name || '').toLowerCase() === canonicalPerson([original.firstName, original.lastName].filter(Boolean).join(' ')).toLowerCase())
  const owner = matches.length === 1 ? matches[0] : fallback
  ready.push([first, last, contact.email, contact.phone, owner.email])
  audit.push([contact.id, p.createdate, contact.real ? 'real' : 'dummy', matches.length === 1 ? 'matched owner' : 'fallback to Carolina', ...ready.at(-1)!])
  seenEmails.add(contact.email); if (contact.phone) seenPhones.add(contact.phone)
  if (contact.real) realEmails++; else dummyEmails++
}
assert.equal(ready.length + existing + repeated, source.length)
assert.equal(realEmails + dummyEmails, ready.length)
const files: string[] = []
for (let from = 0; from < ready.length; from += 10000) {
  const filename = `contacts-new-${from / 10000 + 1}.csv`
  await writeFile(resolve(root, 'exports', filename), csv([headers, ...ready.slice(from, from + 10000)])); files.push(filename)
}
await writeFile(resolve(root, 'exports/contacts-review.csv'), csv([['HubSpot Contact ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Reason'], ...review]))
await writeFile(resolve(root, 'exports/contacts-audit.csv'), csv([['HubSpot Contact ID', 'Created At', 'Email Type', 'Owner Assignment', ...headers], ...audit]))
const report = { source: source.length, ready: ready.length, realEmails, dummyEmails, existing, repeated, files, start: new Date(start).toISOString(), through: new Date(cutoff).toISOString(), checkedAt: new Date().toISOString() }
await writeFile(resolve(cache, 'summary.json'), JSON.stringify(report, null, 2))
const summaryPath = resolve(root, 'exports/summary.json'), summary = JSON.parse(await readFile(summaryPath, 'utf8'))
summary.contacts = report
await writeFile(summaryPath, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(report, null, 2))
