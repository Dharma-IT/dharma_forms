import{mkdir,writeFile,readFile}from'node:fs/promises'
import{resolve}from'node:path'
import{biginRequest}from'../server/submissions.mjs'
import{parseCsv,csv}from'../src/migration.ts'
import{moneyCents}from'../src/migration-line-items.ts'
const root=resolve('.migration-local/product-linking-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(root+'/pages',{recursive:true})
const contacts=new Map<string,any>();let cursor='',page=1,reverse=false,forwardIds=new Set<string>(),requests=0
const usedTokens=new Set<string>();let complete=false
while(!complete){
 const q=new URLSearchParams({fields:'Deal_Name,Phone_Number,Amount,Pipeline,Closing_Date,Paid_Date,Stage,Installments,Contact_Name',per_page:'200',sort_by:'id',sort_order:reverse?'desc':'asc'})
 if(cursor)q.set('page_token',cursor);else q.set('page',String(page))
 let data:any
 try{data=await biginRequest('Pipelines?'+q)}catch(error:any){if(error.message.includes('PAGINATION_LIMIT_EXCEEDED')&&!reverse){forwardIds=new Set(contacts.keys());reverse=true;cursor='';page=1;continue}throw error}
 const overlap=reverse&&(data.data??[]).some((d:any)=>forwardIds.has(d.id))
 for(const d of data.data??[])contacts.set(d.id,d)
 await writeFile(root+'/pages/'+String(requests).padStart(6,'0')+'.json',JSON.stringify(data));requests++
 if(requests%50===0)console.log(JSON.stringify({phase:'reading-bigin-deals',deals:contacts.size,pages:requests}))
 if(overlap||!data.info?.more_records){complete=true;break}
 const next=data.info.next_page_token
 if(next){if(usedTokens.has(next))throw Error('Repeated deal cursor');usedTokens.add(next);cursor=next}else{if(cursor||page>=10)throw Error('Missing Bigin pagination token');page++}
}
const normalize=(v:any)=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ')
const digits=(v:any)=>String(v??'').replace(/\D/g,'')
const key=(pipeline:string,phone:string,name:string)=>[normalize(pipeline),digits(phone),normalize(name)].join('|')
const index=new Map<string,any[]>()
for(const d of contacts.values()){const k=key(d.Pipeline?.name??'',d.Phone_Number,d.Deal_Name);if(!index.has(k))index.set(k,[]);index.get(k)!.push(d)}
const summary=JSON.parse(await readFile('.migration-local/exports/summary.json','utf8'))
const originalAmounts=new Map<string,string>()
for(const slug of ['new-leads','customer-service'])for(const row of parseCsv(await readFile('.migration-local/exports/'+slug+'-financial-audit.csv','utf8')).slice(1))originalAmounts.set(row[0],row[2])
const source=new Map<string,any>()
for(const filename of summary.files){const [h,...rows]=parseCsv(await readFile('.migration-local/exports/'+filename,'utf8'));const at=(name:string)=>h.indexOf(name);for(const row of rows)source.set(row[at('HubSpot Deal ID')],{pipeline:filename.startsWith('new-leads')?'New Leads':'Customer Service',name:row[at('Deal Name')],phone:row[at('Phone Number')],amount:row[at('Amount')],close:row[at('Closing Date')],paid:row[at('Paid Date')],installments:row[at('Installments')]})}
const productRows:string[][]=[]
for(const slug of ['new-leads','customer-service'])productRows.push(...parseCsv(await readFile('.migration-local/exports/'+slug+'-associated-products.csv','utf8')).slice(1))
const parentIds=[...new Set(productRows.map(row=>row[7]))]
const results:Record<string,any>={};const claims=new Map<string,string[]>()
for(const id of parentIds){const s=source.get(id);if(!s){results[id]={status:'parent-not-in-ready-export'};continue}const candidates=index.get(key(s.pipeline,s.phone,s.name))??[]
 const exact=candidates.filter(d=>{const a=moneyCents(String(d.Amount??''));const current=moneyCents(s.amount),original=moneyCents(originalAmounts.get(id)??'');return a!==null&&(a===current||a===original)&&String(d.Closing_Date??'')===s.close&&String(d.Paid_Date??'')===s.paid})
 if(exact.length===1){results[id]={status:'matched',biginId:exact[0].id,source:s,target:exact[0]};if(!claims.has(exact[0].id))claims.set(exact[0].id,[]);claims.get(exact[0].id)!.push(id)}else results[id]={status:exact.length>1?'ambiguous-parent':candidates.length?'parent-values-differ':'parent-not-found',candidateIds:(exact.length?exact:candidates).map(d=>d.id),source:s}
}
for(const [id,sources]of claims)if(sources.length>1)for(const sourceId of sources)results[sourceId]={...results[sourceId],status:'multiple-source-deals-match-one-bigin-deal',biginId:id}
const counts:Record<string,number>={};for(const r of Object.values(results))counts[r.status]=(counts[r.status]??0)+1
await writeFile(root+'/matches.json',JSON.stringify(results))
await writeFile(root+'/product-rows.json',JSON.stringify(productRows))
await writeFile(root+'/deal-match-review.csv',csv([['HubSpot Deal ID','Status','Bigin Candidate IDs'],...Object.entries(results).filter(([,r])=>r.status!=='matched').map(([id,r])=>[id,r.status,(r.candidateIds??[r.biginId].filter(Boolean)).join(';')])]))
const report={directory:root,completeBiginScan:complete,scannedDeals:contacts.size,sourceProductDeals:parentIds.length,counts,completedAt:new Date().toISOString()};await writeFile(root+'/summary.json',JSON.stringify(report,null,2));await writeFile('.migration-local/product-linking-latest.json',JSON.stringify({directory:root}));console.log(JSON.stringify(report,null,2))
