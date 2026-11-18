import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {biginRequest} from '../server/submissions.mjs'
import {parseCsv,csv} from '../src/migration.ts'
const exportRoot=resolve('.migration-local/exports')
const root=process.env.CONTACT_CHECK_ROOT?resolve(process.env.CONTACT_CHECK_ROOT):resolve('.migration-local/contact-check-'+new Date().toISOString().replace(/[:.]/g,'-'))
await mkdir(resolve(root,'pages'),{recursive:true})
const summary=JSON.parse(await readFile(resolve(exportRoot,'summary.json'),'utf8'))
const audit=parseCsv(await readFile(resolve(exportRoot,'audit.csv'),'utf8')).slice(1)
const sourceRows:any[]=[]
for(const pipeline of ['New Leads','Customer Service']){
 const slug=pipeline.toLowerCase().replaceAll(' ','-');const ids=audit.filter(row=>row[1]===pipeline&&row[6]==='ready').map(row=>row[0]);let offset=0
 for(const filename of summary.files.filter((f:string)=>f.startsWith(slug+'-'))){for(const row of parseCsv(await readFile(resolve(exportRoot,filename),'utf8')).slice(1))sourceRows.push({id:ids[offset++],pipeline,row,disposition:'ready'})}
 for(const row of parseCsv(await readFile(resolve(exportRoot,slug+'-review.csv'),'utf8')).slice(1))sourceRows.push({id:row[0],pipeline,row:row.slice(2),disposition:'review'})
}
if(sourceRows.length!==summary.selected)throw Error('Source deal reconciliation failed')
const sourceRowsById=new Map(sourceRows.map(row=>[row.id,row]))
const contacts=new Map<string,any>();let cursor='',page=1,requests=0,reverse=false;let coverageComplete=false;const cursors=new Set<string>()
const cachedFiles=(await readdir(resolve(root,'pages'))).filter(f=>f.endsWith('.json')).sort()
for(const file of cachedFiles){const saved=JSON.parse(await readFile(resolve(root,'pages',file),'utf8'));for(const contact of saved.data??[])contacts.set(contact.id,contact);requests++;cursor=saved.info?.next_page_token??'';page=(saved.info?.page??page)+1;if(!saved.info?.more_records)coverageComplete=true}
for(;!coverageComplete;){
 const query=new URLSearchParams({fields:'First_Name,Last_Name,Email,Phone,Mobile',per_page:'200',sort_by:'id',sort_order:reverse?'desc':'asc',approved:'both'})
 if(cursor)query.set('page_token',cursor);else query.set('page',String(page))
 let result:any
 for(let attempt=0;attempt<5;attempt++){try{result=await biginRequest('Contacts?'+query);break}catch(err:any){if(err.message.includes('PAGINATION_LIMIT_EXCEEDED')&&!reverse){reverse=true;cursor='';page=1;result=null;break}if(attempt===4||!/LIMIT|429|500|502|503|504|timeout/i.test(err.message))throw err;await new Promise(r=>setTimeout(r,1500*(attempt+1)))}}
 if(result===null)continue
 const overlapped=reverse&&(result.data??[]).some((c:any)=>contacts.has(c.id))
 await writeFile(resolve(root,'pages',`${String(requests).padStart(6,'0')}.json`),JSON.stringify(result))
 for(const contact of result.data??[])contacts.set(contact.id,contact)
 requests++
 if(requests%25===0)console.log(JSON.stringify({phase:'reading-bigin-contacts',contacts:contacts.size,pages:requests}))
 if(overlapped||!result.info?.more_records){coverageComplete=true;break}
 const next=result.info.next_page_token
 if(next){if(cursors.has(next))throw Error('Repeated Bigin cursor');cursors.add(next);cursor=next}
 else {if(cursor||page>=10)throw Error('Bigin did not provide a cursor beyond 2000 records');page++}
}
const digits=(value:any)=>String(value??'').replace(/\D/g,'')
const phoneIndex=new Map<string,Set<string>>(),emailIndex=new Map<string,Set<string>>()
function add(index:Map<string,Set<string>>,key:string,id:string){if(!key)return;if(!index.has(key))index.set(key,new Set());index.get(key)!.add(id)}
for(const c of contacts.values()){
 for(const value of [c.Phone,c.Mobile])add(phoneIndex,digits(value),c.id)
 const email=String(c.Email??'').trim().toLowerCase();add(emailIndex,email,c.id)
 if(/^\d+@dummy\.com$/.test(email))add(phoneIndex,email.split('@')[0],c.id)
}
const groups=new Map<string,any>()
for(const d of sourceRows){const phone=digits(d.row[3]);const key=phone||'deal:'+d.id;if(!groups.has(key))groups.set(key,{phone,email:d.row[10].trim().toLowerCase(),names:new Set(),ids:[],pipelines:new Set(),readyDeals:0,reviewDeals:0});const g=groups.get(key);g.names.add(d.row[13]||d.row[0]);g.ids.push(d.id);g.pipelines.add(d.pipeline);g[d.disposition==='ready'?'readyDeals':'reviewDeals']++}
const headers=['Phone digits','Export Email','Export Contact Names','Pipelines','Deal Count','Ready Deals','Review Deals','HubSpot Deal IDs','Match Status','Bigin Contact IDs','Bigin Contact Names','Bigin Emails','Bigin Phones']
const output:Record<string,string[][]>={matched:[],missing:[],ambiguous:[],unidentifiable:[]}
const usedContacts=new Set<string>();const pipelineCounts:Record<string,any>={}
for(const name of ['New Leads','Customer Service'])pipelineCounts[name]={matched:0,missing:0,ambiguous:0,unidentifiable:0}
let readyMatched=0,readyMissing=0,readyAmbiguous=0
for(const g of groups.values()){
 const candidates=new Set<string>([...(phoneIndex.get(g.phone)??[]),...(emailIndex.get(g.email)??[])])
 const status=!g.phone&&!g.email?'unidentifiable':candidates.size===1?'matched':candidates.size>1?'ambiguous':'missing'
 const cs=[...candidates].map(id=>contacts.get(id));for(const id of candidates)usedContacts.add(id)
 output[status].push([g.phone,g.email,[...g.names].join('; '),[...g.pipelines].join('; '),String(g.ids.length),String(g.readyDeals),String(g.reviewDeals),g.ids.join(';'),status,[...candidates].join(';'),cs.map(c=>`${c.First_Name??''} ${c.Last_Name??''}`.trim()).join('; '),cs.map(c=>c.Email??'').join('; '),cs.map(c=>[c.Phone,c.Mobile].filter(Boolean).join(' / ')).join('; ')])
 for(const id of g.ids){const deal=sourceRowsById.get(id);pipelineCounts[deal.pipeline][status]++}
 if(status==='matched')readyMatched+=g.readyDeals
 if(status==='missing')readyMissing+=g.readyDeals
 if(status==='ambiguous')readyAmbiguous+=g.readyDeals
}
for(const [name,rows]of Object.entries(output))await writeFile(resolve(root,name+'.csv'),csv([headers,...rows]))
const extra=[...contacts.values()].filter(c=>!usedContacts.has(c.id))
await writeFile(resolve(root,'bigin-only.csv'),csv([['Bigin Contact ID','First Name','Last Name','Email','Phone','Mobile'],...extra.map(c=>[c.id,c.First_Name??'',c.Last_Name??'',c.Email??'',c.Phone??'',c.Mobile??''])]))
const report={checkedAt:new Date().toISOString(),exportCompletedAt:summary.completedAt,biginContacts:contacts.size,biginPages:requests,coverageComplete,usedReverseScan:reverse,sourceDeals:sourceRows.length,sourceUniquePhoneIdentities:[...groups.values()].filter(g=>g.phone).length,identityResults:Object.fromEntries(Object.entries(output).map(([k,v])=>[k,v.length])),dealResultsByPipeline:pipelineCounts,readyDealResults:{matched:readyMatched,missing:readyMissing,ambiguous:readyAmbiguous},biginContactsWithoutExportMatch:extra.length,notes:['Read-only. No CRM records or migration export files were changed.','Matches use exact normalized phone digits from Phone, Mobile, or dummy email, and exact email. No country code is guessed.','A unique identifier match is not a verified contact identity. Shared numbers can represent different people.','Blank phone/email records cannot be matched with this method. Names are not used to auto-match.','Bigin-only contacts may be legitimate new contacts outside the HubSpot snapshot.'],directory:root}
await writeFile(resolve(root,'summary.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
