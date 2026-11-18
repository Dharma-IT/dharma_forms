import assert from 'node:assert/strict'
import { parseCsv, cleanRow, csv, columns } from './src/migration.ts'
assert.deepEqual(parseCsv('\uFEFFName,Note\r\n"Doe, Jane","two\nlines"\r\n'), [['Name','Note'],['Doe, Jane','two\nlines']])
assert.deepEqual(parseCsv('Name;Phone\nJane;123'), [['Name','Phone'],['Jane','123']])
assert.throws(() => parseCsv('Name,Phone\n"Jane,123'))
assert.throws(() => parseCsv('Name,Phone\nJane,123,extra'))
const source = ['NEW SALE - Jane 123','Virtual','','+1 (347) 500-8081','','','MEDICALLY APPROVED (WON)','','','100','','','']
const map = columns.map((_,i) => i)
const cleaned = cleanRow(source,map,true)
assert.equal(cleaned.row[0],'Jane')
assert.equal(cleaned.row[3],'13475008081')
assert.equal(cleaned.row[10],'13475008081@dummy.com')
assert.equal(cleaned.row[6],'Closed Won')
assert.equal(cleaned.row[8],'Jeuz Vinci')
assert.equal(cleaned.row[11],'2020-01-01')
assert.equal(cleaned.row[12],'WLI')
assert.deepEqual(cleaned.issues,[])
source[11]='2026-99-99'
assert.equal(cleanRow(source,map,true).issues.length,1)
source[11]='2026-02-30'
assert.equal(cleanRow(source,map,true).issues.length,1)
source[11]='2026-11-18T10:30:00Z'
assert.equal(cleanRow(source,map,false).row[11],'2026-11-18')
assert.equal(cleanRow(source,map,false).row[8],'')
assert.ok(csv([['=HYPERLINK("bad")']]).includes("'="))
console.log('Migration parsing and cleaning checks passed.')
assert.equal(cleanRow(['Sellers - Jane Doe',...source.slice(1)],map,true).row[0], 'Sellers - Jane Doe')
assert.equal(cleanRow(['CS - Jane Doe',...source.slice(1)],map,true).row[0], 'CS - Jane Doe')
assert.equal(cleanRow(['Nutritionist - Jane Doe',...source.slice(1)],map,true).row[0], 'Nutri - Jane Doe')
assert.equal(cleanRow(['CS - 123',...source.slice(1)],map,true).row[0], '')
