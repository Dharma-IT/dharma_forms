import{readFile,writeFile}from'node:fs/promises'
import{csv}from'../src/migration.ts'
const root=JSON.parse(await readFile('.migration-local/product-linking-latest.json','utf8')).directory
const result=JSON.parse(await readFile(root+'/association-summary.json','utf8')),ledger=JSON.parse(await readFile(root+'/link-results.json','utf8')),matches=JSON.parse(await readFile(root+'/matches.json','utf8')),rows:string[][]=JSON.parse(await readFile(root+'/product-rows.json','utf8'))
const pending:Record<string,string[][]>={'New Leads':[],'Customer Service':[]};const completed:Record<string,string[][]>={'New Leads':[],'Customer Service':[]}
const counts:Record<string,any>={}
for(const row of rows){const r=ledger[row[7]];const match=matches[row[7]];const next=[...row];next[0]=r?.biginId??(match?.status==='matched'?match.biginId:'');const status=r?.status??'review';next.push(status);if(!['verified-associated','already-associated'].includes(status))next[13]=[next[13],r?.reason??r?.code??status].filter(Boolean).join('; ')
 if(!counts[row[9]])counts[row[9]]={attachedRows:0,pendingRows:0,attachedDeals:new Set(),pendingDeals:new Set()}
 if(['verified-associated','already-associated'].includes(status)){next[14]='Already attached in Bigin; do not re-import';completed[row[9]].push(next);counts[row[9]].attachedRows++;counts[row[9]].attachedDeals.add(row[7])}else{pending[row[9]].push(next);counts[row[9]].pendingRows++;counts[row[9]].pendingDeals.add(row[7])}
}
const headers=['Parent ID','Product ID','Product Name','List Price','Quantity','Discount (%)','Source Line Total','HubSpot Deal ID','HubSpot Line Item ID','Pipeline','Deal Name','Phone Number','Email','Product Review Issues','Linking Requirement','Association Status']
for(const name of Object.keys(pending)){const slug=name.toLowerCase().replaceAll(' ','-');await writeFile('.migration-local/exports/'+slug+'-associated-products.csv',csv([headers,...pending[name]]));await writeFile('.migration-local/exports/'+slug+'-associated-products-completed.csv',csv([headers,...completed[name]]));counts[name].attachedDeals=counts[name].attachedDeals.size;counts[name].pendingDeals=counts[name].pendingDeals.size}
const summary=JSON.parse(await readFile('.migration-local/exports/summary.json','utf8'));summary.productAssociation={...result,pipelines:counts};await writeFile('.migration-local/exports/summary.json',JSON.stringify(summary,null,2)+'\n')
console.log(JSON.stringify({pipelines:counts,dealCounts:result.dealCounts,productRowCounts:result.productRowCounts},null,2))
