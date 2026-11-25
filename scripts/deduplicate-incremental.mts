import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { biginRequest } from '../server/submissions.mjs'
import { csv, parseCsv, dealColumns } from '../src/migration.ts'

const root = resolve(process.env.MIGRATION_ROOT || '')
if (!process.env.MIGRATION_ROOT || !root.includes('.migration-local')) throw Error('Set a separate MIGRATION_ROOT')
const output = resolve(root, 'exports')
const summary = JSON.parse(await readFile(resolve(output, 'summary.json'), 'utf8'))
if (summary.duplicateCheck) throw Error('This export was already checked; regenerate before checking again')
const rows: { pipeline: string; row: string[] }[] = []
for (const file of summary.files) {
  const [headers, ...records] = parseCsv(await readFile(resolve(output, file), 'utf8'))
  assert.deepEqual(headers, dealColumns)
  records.forEach(row => rows.push({ pipeline: file.startsWith('new-leads-') ? 'New Leads' : 'Customer Service', row }))
}
const at = (label: string) => dealColumns.indexOf(label)
const digits = (value: unknown) => String(value || '').replace(/\D/g, '')
const phones = [...new Set(rows.map(item => digits(item.row[at('Phone Number')])))]
assert.ok(phones.every(phone => /^\d+$/.test(phone)))
const targets = new Map<string, any>()
await mkdir(resolve(root, 'duplicate-searches'), { recursive: true })
for (let offset = 0; offset < phones.length; offset += 10) {
  const chunk = phones.slice(offset, offset + 10)
  const criteria = chunk.map(phone => `(Phone_Number:equals:${phone})`).reduce((a, b) => `(${a}or${b})`)
  for (let page = 1; ; page++) {
    const result = await biginRequest(`Pipelines/search?${new URLSearchParams({ criteria, page: String(page), per_page: '200' })}`)
    await writeFile(resolve(root, 'duplicate-searches', `${offset}-${page}.json`), JSON.stringify(result))
    for (const deal of result.data || []) targets.set(deal.id, deal)
    if (!result.info?.more_records) break
    if (page >= 10) throw Error('Search limit reached; split the phone batch before exporting')
  }
  if (offset % 100 === 0) console.log(JSON.stringify({ phase: 'duplicate-check', checked: Math.min(offset + 10, phones.length), phones: phones.length }))
}
const candidates = new Map<string, any[]>()
for (const deal of targets.values()) {
  const pipeline = typeof deal.Pipeline === 'string' ? deal.Pipeline : deal.Pipeline?.name
  if (!pipeline || !deal.Phone_Number) throw Error('Bigin search omitted the pipeline or phone needed for duplicate detection')
  const key = `${pipeline}|${digits(deal.Phone_Number)}`
  candidates.set(key, [...candidates.get(key) || [], deal])
}
const ready: typeof rows = [], held: string[][] = []
for (const item of rows) {
  const matches = candidates.get(`${item.pipeline}|${digits(item.row[at('Phone Number')])}`) || []
  // Same-client repeat purchases may be legitimate. Hold every candidate for
  // human review rather than guessing that a source deal was already imported.
  if (matches.length) held.push([item.row[at('HubSpot Deal ID')], item.pipeline, item.row[at('Deal Name')], item.row[at('Phone Number')], matches.map(deal => deal.id).join(';'), matches.map(deal => deal.Deal_Name).join(';'), 'Same phone and pipeline exists in Bigin; compare before importing', ...item.row])
  else ready.push(item)
}
const keptIds = new Set(ready.map(item => item.row[at('HubSpot Deal ID')]))
assert.equal(keptIds.size, ready.length)
assert.equal(ready.length + held.length, rows.length)
// Keep the unfiltered export isolated for audit, never present it as a download.
await mkdir(resolve(root, 'before-duplicate-check'), { recursive: true })
const files: string[] = []
for (const file of summary.files) await writeFile(resolve(root, 'before-duplicate-check', file), await readFile(resolve(output, file)))
for (const pipeline of ['New Leads', 'Customer Service']) {
  const slug = pipeline.toLowerCase().replaceAll(' ', '-')
  const records = ready.filter(item => item.pipeline === pipeline).map(item => item.row)
  for (let offset = 0; offset < records.length; offset += 10000) {
    const file = `${slug}-${offset / 10000 + 1}.csv`
    await writeFile(resolve(output, file), csv([dealColumns, ...records.slice(offset, offset + 10000)]))
    files.push(file)
  }
  summary.ready[pipeline] = records.length
  // Product files must not include parents withheld as possible duplicates.
  for (const kind of ['associated-products', 'products', 'financial-audit']) {
    const file = `${slug}-${kind}.csv`
    const [headers, ...records] = parseCsv(await readFile(resolve(output, file), 'utf8'))
    const idIndex = headers.indexOf('HubSpot Deal ID')
    assert.ok(idIndex >= 0)
    await writeFile(resolve(root, 'before-duplicate-check', file), csv([headers, ...records]))
    await writeFile(resolve(output, file), csv([headers, ...records.filter(row => keptIds.has(row[idIndex]))]))
  }
}
await writeFile(resolve(output, 'duplicate-review.csv'), csv([['Source HubSpot Deal ID', 'Source Pipeline', 'Source Deal Name', 'Source Phone', 'Bigin Candidate IDs', 'Bigin Candidate Names', 'Reason', ...dealColumns], ...held]))
const heldIds = new Set(held.map(row => row[0]))
for (const file of ['audit.csv', 'new-leads-audit.csv', 'customer-service-audit.csv']) {
  const [headers, ...records] = parseCsv(await readFile(resolve(output, file), 'utf8'))
  const disposition = headers.indexOf('Disposition')
  for (const row of records) if (heldIds.has(row[0])) row[disposition] = 'possible duplicate - review'
  await writeFile(resolve(output, file), csv([headers, ...records]))
}
const source = JSON.parse(await readFile(resolve(root, 'search-pages/cutoff.json'), 'utf8'))
summary.files = files
summary.dateRange = { start: process.env.MIGRATION_START, through: new Date(source.cutoff).toISOString(), timezone: 'America/New_York' }
summary.duplicateCheck = { checkedAt: new Date().toISOString(), sourceRows: rows.length, heldForReview: held.length, ready: ready.length, matchedBiginDeals: targets.size, method: 'Live Bigin phone and pipeline search; candidates held for manual review, including possible repeat purchases.' }
await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ ready: summary.ready, duplicateCheck: summary.duplicateCheck, files }, null, 2))
