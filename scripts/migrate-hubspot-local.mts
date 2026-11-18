import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalPerson, cleanRow, columns, csv } from '../src/migration.ts'
import { biginRequest, getFormMetadata } from '../server/submissions.mjs'

const root = resolve('.migration-local')
await mkdir(root, {recursive:true})
const tokenKey = Object.keys(process.env).find(k => /HUBSPOT.*(TOKEN|KEY)/i.test(k))
if (!tokenKey) throw Error('No HubSpot token configured')
async function hub(path: string, body?: unknown): Promise<any> {
  for (let attempt=0; attempt<6; attempt++) {
    const response = await fetch(`https://api.hubapi.com${path}`, {method:body?'POST':'GET', headers:{Authorization:`Bearer ${process.env[tokenKey!]}`, 'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
    if (response.ok) return response.json()
    if ((response.status===429 || response.status>=500) && attempt<5) { await new Promise(r=>setTimeout(r, Math.min(10000,1000*2**attempt))); continue }
    throw Error(`HubSpot HTTP ${response.status} for ${path.split('?')[0]}`)
  }
}
const pipelines = (await hub('/crm/v3/pipelines/deals')).results
const fields = (await hub('/crm/v3/properties/deals')).results
const target = new Map<string,string>()
for (const pipeline of pipelines) {
  if (/^new leads?(?:\s|$)/i.test(pipeline.label)) target.set(pipeline.id,'New Leads')
  if (/^customer service$/i.test(pipeline.label)) target.set(pipeline.id,'Customer Service')
}
if (target.size!==2) throw Error('Expected exactly two migration pipelines')
if (!fields.some((f:any)=>f.name==='paid_date_all_pipelines')) throw Error('Paid date field not available')
const metadata = await getFormMetadata()
const users = (await biginRequest('users?type=AllUsers')).users ?? []
const activeUsers = users.filter((u:any)=>u.status==='active' && u.confirm!==false)
const fallback = activeUsers.find((u:any)=>u.email?.toLowerCase()==='ca@dharmanutritionclinic.com')
if (!fallback) throw Error('Carolina is not an active Bigin user')
const owners = new Map<string,any>()
for (const archived of ['false','true']) {
  let after=''
  do {
    const page=await hub(`/crm/v3/owners?limit=100&archived=${archived}${after?'&after='+after:''}`)
    for(const owner of page.results) owners.set(owner.id,owner)
    after=page.paging?.next?.after ?? ''
  } while(after)
}
const names = ['dealname','meeting_type','evaluation_date_and_hour_2','phone','agent_lead_management','classification','dealstage','closedate','hubspot_owner_id','amount','paid_date_all_pipelines','pipeline','hs_tag_ids','channel','source','noted','payment_type','product','installment'].filter(n=>fields.some((f:any)=>f.name===n))
const label = (name:string,value:string) => {
  const f=fields.find((f:any)=>f.name===name)
  return value ? value.split(';').map(v=>f?.options?.find((o:any)=>o.value===v)?.label??v).join(';') : ''
}
const cache=resolve(root,'search-pages'); await mkdir(cache,{recursive:true})
const cutoffFile=resolve(cache,'cutoff.json')
let cutoff:number
try { cutoff=JSON.parse(await readFile(cutoffFile,'utf8')).cutoff } catch(err:any) { if(err.code!=='ENOENT')throw err;cutoff=Date.now();await writeFile(cutoffFile,JSON.stringify({cutoff})) }
let requestQueue=Promise.resolve()
async function search(body:any){
 const previous=requestQueue
 let release!:()=>void
 requestQueue=new Promise<void>(r=>{release=r})
 await previous
 const pending=hub('/crm/v3/objects/deals/search',body)
 await new Promise(r=>setTimeout(r,300));release()
 return pending
}
const deals:any[]=[];let scanned=0
const intervals:Array<[number,number]>=[]
async function partition(low:number,high:number):Promise<void>{
 const filterGroups=[{filters:[{propertyName:'pipeline',operator:'IN',values:[...target.keys()]},{propertyName:'createdate',operator:'GTE',value:String(low)},{propertyName:'createdate',operator:'LT',value:String(high)}]}]
 const file=resolve(cache,`count-${low}-${high}.json`);let count:any
 try {count=JSON.parse(await readFile(file,'utf8'))}catch(err:any){if(err.code!=='ENOENT')throw err;count=await search({filterGroups,limit:1,properties:[]});await writeFile(file,JSON.stringify({total:count.total}))}
 if(count.total>9000){const mid=Math.floor((low+high)/2);if(mid===low)throw Error('Too many deals at one timestamp');await partition(low,mid);await partition(mid,high)}else if(count.total)intervals.push([low,high])
}
await partition(0,cutoff)
console.log(JSON.stringify({phase:'partitioned',intervals:intervals.length}))
let nextInterval=0
async function readIntervals(){
 while(nextInterval<intervals.length){
 const [low,high]=intervals[nextInterval++];let after='';const seen=new Set<string>()
 do{
 if(seen.has(after))throw Error('Repeated search cursor');seen.add(after)
 const file=resolve(cache,`data-${low}-${high}-${after||'start'}.json`);let page:any
 try{page=JSON.parse(await readFile(file,'utf8'))}catch(err:any){if(err.code!=='ENOENT')throw err;page=await search({filterGroups:[{filters:[{propertyName:'pipeline',operator:'IN',values:[...target.keys()]},{propertyName:'createdate',operator:'GTE',value:String(low)},{propertyName:'createdate',operator:'LT',value:String(high)}]}],sorts:['hs_object_id'],limit:200,properties:names,...(after?{after}: {})});await writeFile(file,JSON.stringify(page))}
 deals.push(...page.results);scanned+=page.results.length;after=page.paging?.next?.after??''
 if(scanned%5000===0)console.log(JSON.stringify({phase:'reading',scanned}))
 }while(after)
 }
}
await Promise.all([readIntervals(),readIntervals(),readIntervals(),readIntervals()])
if(new Set(deals.map(d=>d.id)).size!==deals.length)throw Error('Duplicate deal IDs in search export')
// Search results do not include associations. Fetch associations in batches.
const associationDir=resolve(root,'associations');await mkdir(associationDir,{recursive:true})
deals.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}))
for(let offset=0;offset<deals.length;offset+=1000){
 const chunk=deals.slice(offset,offset+1000);const file=resolve(associationDir,`${offset}.json`);let data:any
 try{data=JSON.parse(await readFile(file,'utf8'));if(data.ids.join(',')!==chunk.map(d=>d.id).join(','))throw Error('Association cache mismatch')}catch(err:any){if(err.code!=='ENOENT')throw err;data={ids:chunk.map(d=>d.id),...await hub('/crm/v4/associations/deals/contacts/batch/read',{inputs:chunk.map(d=>({id:d.id}))})};await writeFile(file,JSON.stringify(data))}
 const links=new Map(data.results.map((r:any)=>[r.from.id,r.to.map((t:any)=>({id:String(t.toObjectId)}))]))
 for(const deal of chunk)deal.associations={contacts:{results:links.get(deal.id)??[]}}
 if(offset%10000===0)console.log(JSON.stringify({phase:'associations',loaded:Math.min(offset+1000,deals.length),total:deals.length}))
}
console.log(JSON.stringify({phase:'contacts',scanned,selected:deals.length}))
const ids=[...new Set<string>(deals.flatMap(d=>(d.associations?.contacts?.results??[]).map((c:any)=>c.id)))]
const contacts=new Map<string,any>(); const contactDir=resolve(root,'contacts');await mkdir(contactDir,{recursive:true})
let nextContactOffset=0
async function readContacts(){
while(nextContactOffset<ids.length){
  const offset=nextContactOffset;nextContactOffset+=100
  const chunk=ids.slice(offset,offset+100);const file=resolve(contactDir,`${offset}.json`);let result:any
  try { result=JSON.parse(await readFile(file,'utf8')); if(JSON.stringify(result.ids)!==JSON.stringify(chunk))throw Error('Contact cache mismatch') }catch(err:any){
    if(err.code!=='ENOENT')throw err
    result={ids:chunk,...await hub('/crm/v3/objects/contacts/batch/read',{properties:['firstname','lastname','phone','mobilephone','email'],inputs:chunk.map(id=>({id}))})};await writeFile(file,JSON.stringify(result))
  }
  for(const c of result.results)contacts.set(c.id,c.properties)
  if(offset%2500===0)console.log(JSON.stringify({phase:'contacts',loaded:Math.min(offset+100,ids.length),total:ids.length}))
}
}
await Promise.all([readContacts(),readContacts(),readContacts()])
const output=resolve(root,'exports');await mkdir(output,{recursive:true})
const groups:Record<string,string[][]>={'New Leads':[],'Customer Service':[]}
const review:string[][]=[];const issueCounts:Record<string,number>={};let fallbackCount=0,recoveredPhones=0,paidDates=0,missingPaidDates=0
const audit:string[][]=[]
for(const deal of deals){
 const p=deal.properties;const pipeline=target.get(p.pipeline)!;const issues:string[]=[]
 const associated=deal.associations?.contacts?.results??[]
 if(associated.some((a:any)=>!contacts.has(a.id)))issues.push('Linked contact could not be retrieved')
 const linked=associated.map((a:any)=>({id:a.id,...contacts.get(a.id)}))
 let phone=p.phone??''
 if(!phone.replace(/\D/g,'')) {const recovered=linked.map((c:any)=>c.phone||c.mobilephone||(/^\d+@dummy\.com$/i.test(c.email??'')?c.email.split('@')[0]:'')).find((v:any)=>v?.replace(/\D/g,''));if(recovered){phone=recovered;recoveredPhones++}}
 let ownerEmail=''
 if(p.hubspot_owner_id){
  const owner=owners.get(p.hubspot_owner_id)
  const fullName=owner?`${owner.firstName??''} ${owner.lastName??''}`.trim():''
  let matches=owner?.email?activeUsers.filter((u:any)=>u.email?.toLowerCase()===owner.email.toLowerCase()):[]
  if(!matches.length && fullName)matches=activeUsers.filter((u:any)=>canonicalPerson(u.full_name??'').toLowerCase()===canonicalPerson(fullName).toLowerCase())
  if(matches.length===1)ownerEmail=matches[0].email
  else {ownerEmail=owner?.email||fullName||p.hubspot_owner_id;issues.push('Existing HubSpot owner has no unique active Bigin match')}
 }else{ownerEmail=fallback.email;fallbackCount++}
 const originalStage=pipelines.find((v:any)=>v.id===p.pipeline)?.stages.find((s:any)=>s.id===p.dealstage)?.label??p.dealstage
 const input=[p.dealname,label('meeting_type',p.meeting_type),p.evaluation_date_and_hour_2,phone,label('agent_lead_management',p.agent_lead_management),label('classification',p.classification),originalStage,p.closedate,ownerEmail,p.amount,'',p.paid_date_all_pipelines,p.product,'',label('hs_tag_ids',p.hs_tag_ids),label('channel',p.channel),label('source',p.source),p.noted,label('payment_type',p.payment_type),p.installment,'',''].map(v=>String(v??''))
 if(linked.length===1)input[13]=`${linked[0].firstname??''} ${linked[0].lastname??''}`.trim()
 if(linked.length>1)issues.push('Multiple linked HubSpot contacts: verify Bigin contact association')
 const cleaned=cleanRow(input,columns.map((_,i)=>i),true,pipeline)
 issues.push(...cleaned.issues)
 const live=metadata.pipelines.find((v:any)=>v.name===pipeline)!
 if(!live.stages.includes(cleaned.row[6]))issues.push('Stage is not in live Bigin pipeline')
 for(const index of [4,15,16,18]){
   const field=live.fields.find((f:any)=>f.field_label===columns[index]);const options=(field?.pick_list_values??[]).map((o:any)=>o.display_value||o.actual_value)
   if(cleaned.row[index] && options.length && !options.includes(cleaned.row[index]))issues.push(`${columns[index]} is not in live Bigin options`)
 }
 if(p.paid_date_all_pipelines)paidDates++;else missingPaidDates++
 audit.push([deal.id,pipeline,p.hubspot_owner_id??'',ownerEmail,linked.map((c:any)=>c.id).join(';'),p.paid_date_all_pipelines??'',issues.length?'review':'ready'])
 if(issues.length){for(const issue of new Set(issues)){const key=issue.split(':')[0];issueCounts[key]=(issueCounts[key]??0)+1}review.push([deal.id,[...new Set(issues)].join('; '),...cleaned.row])}
 else groups[pipeline].push(cleaned.row)
}
const files:string[]=[]
for(const [name,rows]of Object.entries(groups))for(let offset=0;offset<rows.length;offset+=10000){const filename=`${name.toLowerCase().replaceAll(' ','-')}-${1+offset/10000}.csv`;await writeFile(resolve(output,filename),csv([columns,...rows.slice(offset,offset+10000)]));files.push(filename)}
await writeFile(resolve(output,'review.csv'),csv([['HubSpot Deal ID','Issues',...columns],...review]))
await writeFile(resolve(output,'audit.csv'),csv([['HubSpot Deal ID','Pipeline','HubSpot Owner ID','Export Owner','HubSpot Contact IDs','Original Paid Date','Disposition'],...audit]))
for (const name of Object.keys(groups)) {
 const slug=name.toLowerCase().replaceAll(' ','-')
 await writeFile(resolve(output,slug+'-review.csv'),csv([['HubSpot Deal ID','Issues',...columns],...review.filter(row=>row[22]===name)]))
 await writeFile(resolve(output,slug+'-audit.csv'),csv([['HubSpot Deal ID','Pipeline','HubSpot Owner ID','Export Owner','HubSpot Contact IDs','Original Paid Date','Disposition'],...audit.filter(row=>row[1]===name)]))
}
const reviewByPipeline=Object.fromEntries(Object.keys(groups).map(name=>[name,review.filter(row=>row[22]===name).length]))
const report={reviewByPipeline,completedAt:new Date().toISOString(),scanned,selected:deals.length,ready:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),review:review.length,fallbackCount,recoveredPhones,paidDates,missingPaidDates,issueCounts,files,notes:['Read-only HubSpot and Bigin access. No CRM writes.','Missing dates use the reference 2020-01-01 placeholder. Original paid dates are retained in audit.csv.','Email is auxiliary; match Contact Name to existing Bigin contacts at import.','Existing owners without a unique active Bigin user match are excluded for review.','Cached source snapshot can be resumed; use a new cache directory for a fresh export.']}
if(Object.values(groups).reduce((n,r)=>n+r.length,0)+review.length!==deals.length)throw Error('Reconciliation failed')
await writeFile(resolve(output,'summary.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))


