import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseCsv, columns, dealColumns } from '../src/migration.ts'
const root='.migration-local/exports/'
const summary=JSON.parse(await readFile(root+'summary.json','utf8'))
const audit=parseCsv(await readFile(root+'audit.csv','utf8')).slice(1)
const review=parseCsv(await readFile(root+'review.csv','utf8')).slice(1)
assert.equal(audit.length,summary.selected)
assert.equal(new Set(audit.map(row=>row[0])).size,summary.selected)
assert.equal(review.length,summary.review)
const counts:Record<string,number>={}
for(const pipeline of ['New Leads','Customer Service']) {
 const slug=pipeline.toLowerCase().replaceAll(' ','-')
 const rows:string[][]=[]
 for(const name of summary.files.filter((file:string)=>file.startsWith(slug+'-'))) {
  const table=parseCsv(await readFile(root+name,'utf8'))
  assert.deepEqual(table[0],dealColumns)
  assert.ok(table.length>1 && table.length<=10001)
  rows.push(...table.slice(1).map(exported=>columns.map((column,index)=>index===20?pipeline:exported[table[0].indexOf(column)]??'')))
 }
 const readyAudit=audit.filter(row=>row[1]===pipeline&&row[6]==='ready')
 assert.equal(rows.length,readyAudit.length)
 assert.equal(rows.length,summary.ready[pipeline])
 rows.forEach((row,index)=>{
  assert.equal(row[20],pipeline)
  assert.equal(row[8],readyAudit[index][3])
  assert.ok(row[8]&&!/^\d+$/.test(row[8]))
  assert.equal(row[11],readyAudit[index][5]?.slice(0,10)||'2020-01-01')
  assert.equal(row[10],row[3]+'@dummy.com')
 })
 const excluded=parseCsv(await readFile(root+slug+'-review.csv','utf8')).slice(1)
 assert.equal(excluded.length,summary.reviewByPipeline[pipeline])
 assert.ok(excluded.every(row=>row[22]===pipeline))
 counts[pipeline]=rows.length+excluded.length
}
assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),149671)
console.log(JSON.stringify({verified:true,sourceTotals:counts,ready:summary.ready,reviewByPipeline:summary.reviewByPipeline,files:summary.files},null,2))

const reassigned = audit.filter(row=>row[9]==='unmatched owner assigned to Carolina')
assert.equal(reassigned.length, summary.unmatchedOwnerFallbackCount)
assert.ok(reassigned.every(row=>row[2] && row[3]==='ca@dharmanutritionclinic.com'))
assert.equal(audit.filter(row=>row[9]!=='matched').length, summary.fallbackCount)

for(const pipeline of ['New Leads','Customer Service']) {
 const slug=pipeline.toLowerCase().replaceAll(' ','-')
 const financial=new Map(parseCsv(await readFile(root+slug+'-financial-audit.csv','utf8')).slice(1).map(row=>[row[0],row]))
 for(const filename of summary.files.filter((file:string)=>file.startsWith(slug+'-'))) {
  for(const row of parseCsv(await readFile(root+filename,'utf8')).slice(1)) {
   const expected=financial.get(row[dealColumns.indexOf('HubSpot Deal ID')])!
   assert.ok(expected)
   assert.equal(row[9],expected[4])
   assert.equal(row[19],expected[5])
   assert.ok(row[19]===''||/^-?\d+(?:\.\d+)?$/.test(row[19]))
  }
 }
}
console.log('Amount, currency Installments and source deal IDs verified.')
