import assert from 'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{prepareSpecialExport,exportSpecialCsv}from'../src/migration-special-export.ts'
import{parseCsv}from'../src/migration.ts'
const path='C:/Users/jeuzv/Downloads/new-leads-11.csv'
const text=await readFile(path,'utf8'),raw=parseCsv(text),result=prepareSpecialExport(text)
assert.equal(result.contacts.length,151)
assert.equal(result.deals.length,167)
assert.equal(result.duplicates,16)
assert.equal(result.excluded,0)
assert.ok(!result.dealHeaders.includes('Errors'))
for(let i=0;i<result.deals.length;i++)for(let j=0;j<result.dealHeaders.length;j++)assert.equal(result.deals[i][j],raw[i+1][raw[0].indexOf(result.dealHeaders[j])])
assert.equal(prepareSpecialExport(text,result.contacts.map(row=>row[2])).contacts.length,0)
const output=exportSpecialCsv(result.dealHeaders,result.deals)
assert.equal(parseCsv(output).length,168)
await writeFile('C:/Users/jeuzv/Downloads/new-leads-11-retry.csv',output)
await writeFile('.migration-local/exports/new-leads-skipped-special.csv',output)
console.log(JSON.stringify({retryDeals:result.deals.length,uniqueContacts:result.contacts.length,verifiedValuesUnchanged:true,output:'C:/Users/jeuzv/Downloads/new-leads-11-retry.csv'}))
