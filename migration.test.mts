import assert from 'node:assert/strict'
import { parseCsv, cleanRow, csv, columns } from './src/migration.ts'
assert.deepEqual(parseCsv('\uFEFFName,Note\r\n"Doe, Jane","two\nlines"\r\n'), [['Name','Note'],['Doe, Jane','two\nlines']])
assert.deepEqual(parseCsv('Name;Phone\nJane;123'), [['Name','Phone'],['Jane','123']])
assert.throws(() => parseCsv('Name,Phone\n"Jane,123'))
assert.throws(() => parseCsv('Name,Phone\nJane,123,extra'))
const source = ['NEW SALE - Jane 123','Virtual','','+1 (347) 500-8081','','','MEDICALLY APPROVED (WON)','','Alex Rivera','100','','','']
const map = columns.map((_,i) => i)
const cleaned = cleanRow(source,map,true)
assert.equal(cleaned.row[0],'Sellers - Jane')
assert.equal(cleaned.row[3],'13475008081')
assert.equal(cleaned.row[10],'13475008081@dummy.com')
assert.equal(cleaned.row[6],'Closed Won')
assert.equal(cleaned.row[8],'Alex Rivera')
assert.equal(cleaned.row[11],'2020-01-01')
assert.equal(cleaned.row[12],'WLI')
assert.deepEqual(cleaned.issues,[])
source[11]='2026-99-99'
assert.equal(cleanRow(source,map,true).issues.length,1)
source[11]='2026-02-30'
assert.equal(cleanRow(source,map,true).issues.length,1)
source[11]='2026-11-18T10:30:00Z'
assert.equal(cleanRow(source,map,false).row[11],'2026-11-18')
assert.equal(cleanRow(source,map,false).row[8],'Alex Rivera')
assert.ok(csv([['=HYPERLINK("bad")']]).includes("'="))
console.log('Migration parsing and cleaning checks passed.')
assert.equal(cleanRow(['Sellers - Jane Doe',...source.slice(1)],map,true).row[0], 'Sellers - Jane Doe')
assert.equal(cleanRow(['CS - Jane Doe',...source.slice(1)],map,true).row[0], 'CS - Jane Doe')
assert.equal(cleanRow(['Nutritionist - Jane Doe',...source.slice(1)],map,true).row[0], 'Nutri - Jane Doe')
assert.equal(cleanRow(['CS - 123',...source.slice(1)],map,true).row[0], 'Client - 13475008081')

source[8] = ''
assert.equal(cleanRow(source,map,true).row[8], 'ca@dharmanutritionclinic.com')
assert.ok(!cleanRow(source,map,true).issues.some(issue => issue.includes('Missing deal owner')))
assert.equal(cleanRow(source,map,false).row[8], 'ca@dharmanutritionclinic.com')
source[8] = '123456'
assert.ok(cleanRow(source,map,true).issues.some(issue => issue.includes('owner ID')))
source[8] = 'alex@example.com'
assert.equal(cleanRow(source,map,true).row[8], 'alex@example.com')


source[6] = 'PAID'
source[11] = '2026-11-18'
source[15] = 'call'
source[16] = 'Facebook'
source[18] = 'Zelle'
source[19] = '20.52'
const verified = cleanRow(source,map,false,'New Leads')
assert.equal(verified.row[11], '2026-11-18')
assert.equal(verified.row[13], 'Jane')
assert.equal(verified.row[15], 'Call')
assert.equal(verified.row[19], '20.52')
assert.equal(verified.row[20], 'New Leads')
assert.equal(verified.row[21], 'New Leads')
assert.equal(verified.issues.length, 0)
source[18] = 'Unknown payment'
assert.ok(cleanRow(source,map,false,'Customer Service').issues.some(issue => issue.includes('Payment Method')))
assert.equal(cleanRow(source,map,false,'Customer Service').row[21], 'Customer Service')
assert.equal(columns[11], 'Paid Date')
assert.equal(columns[5], 'Lead Cassification')

const { canonicalPerson } = await import('./src/migration.ts')
for (const name of ['Aline Strelow','Alice Strelow','Alice F','alice f.']) assert.equal(canonicalPerson(name),'Alice Strelow')
assert.equal(canonicalPerson('Alice Smith'),'Alice Smith')
source[4]='Alice F'
assert.equal(cleanRow(source,map,false,'New Leads').row[4],'Aline Strelow')

for (const name of ['Maria Sandoval','Ana Sandoval',' MARIA SANDOVAL ']) assert.equal(canonicalPerson(name),'Ana Sandoval')
assert.equal(canonicalPerson('Maria Sanchez'),'Maria Sanchez')

for (const channel of ['Aircall','Doxy','WhatsApp']) {
 source[15]=channel
 assert.equal(cleanRow(source,map,false,'New Leads').row[15],'Call')
}
source[15]=''
assert.equal(cleanRow(source,map,false,'New Leads').row[15],'Call')


assert.equal(cleanRow(['Jane Doe',...source.slice(1)],map,false,'New Leads').row[0],'Jane Doe')


source[16]='Repurchase list'
assert.equal(cleanRow(source,map,false,'New Leads').row[16],'')
assert.ok(!cleanRow(source,map,false,'New Leads').issues.some(issue=>issue.startsWith('Source')))
source[16]=''
assert.equal(cleanRow(source,map,false,'Customer Service').row[16],'')
source[16]='facebook'
assert.equal(cleanRow(source,map,false,'New Leads').row[16],'Facebook')

const fallbackSource = [...source]
fallbackSource[0]='2147302774 - 12147302774 -'
fallbackSource[3]=''
assert.equal(cleanRow(fallbackSource,map,false,'New Leads').row[0],'Client - 12147302774')
assert.ok(cleanRow(fallbackSource,map,false,'New Leads').issues.includes('Missing phone'))
fallbackSource[0]='CS -'
assert.ok(cleanRow(fallbackSource,map,false,'New Leads').issues.includes('Missing usable deal name'))

source[19]='true'
assert.ok(cleanRow(source,map,false,'New Leads').issues.includes('Installments must be a currency amount'))
source[19]=''
assert.ok(!cleanRow(source,map,false,'New Leads').issues.some(issue=>issue.startsWith('Installments')))
