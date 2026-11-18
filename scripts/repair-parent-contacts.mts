import{readFile,mkdir,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{resolve}from'node:path'
import{parseCsv}from'../src/migration.ts'
import{biginRequest}from'../server/submissions.mjs'
const file='C:/Users/jeuzv/Downloads/new-leads-11.csv'
const source=await readFile(file,'utf8');const digest=createHash('sha256').update(source).digest('hex')
const root=resolve('.migration-local/parent-contact-repair-'+digest.slice(0,12));await mkdir(root,{recursive:true})
const table=parseCsv(source),headers=table[0],rows=table.slice(1)
const index=(name:string)=>{const n=headers.indexOf(name);if(n<0)throw Error('Missing column '+name);return n}
const emailIndex=index('Email'),phoneIndex=index('Phone Number'),nameIndex=index('Deal Name'),ownerIndex=index('Deal Owner'),errorIndex=index('Errors')
const targets=new Map<string,any>()
for(const row of rows){if(row[errorIndex]!=='Could not find a matching parent record for this lookup field. - Email.')throw Error('Unexpected error type; file requires separate review');const email=row[emailIndex].trim().toLowerCase(),phone=row[phoneIndex].replace(/\D/g,'');if(!phone||email!==phone+'@dummy.com')throw Error('Invalid phone/dummy email mapping');if(!targets.has(email))targets.set(email,{email,phone,name:row[nameIndex].replace(/^(?:sellers?|cs|nutri)\s*-\s*/i,'').trim(),owner:row[ownerIndex].trim().toLowerCase(),rows:0});targets.get(email).rows++}
const users=(await biginRequest('users?type=AllUsers')).users??[]
const ownerIds=new Map(users.filter((u:any)=>u.status==='active').map((u:any)=>[u.email.toLowerCase(),u.id]));const fallback=ownerIds.get('ca@dharmanutritionclinic.com');if(!fallback)throw Error('Carolina user not available')
const statusFile=resolve(root,'results.json');let results:Record<string,any>={}
try{results=JSON.parse(await readFile(statusFile,'utf8'))}catch(e:any){if(e.code!=='ENOENT')throw e}
const persist=async()=>writeFile(statusFile,JSON.stringify(results,null,2)+'\n')
async function find(email:string,phone?:string){const q=new URLSearchParams(phone?{phone}:{email});const r=await biginRequest('Contacts/search?'+q);return(r.data??[]).filter((c:any)=>phone?[c.Phone,c.Mobile,/^\d+@dummy\.com$/i.test(c.Email??'')?c.Email.split('@')[0]:''].some(v=>String(v??'').replace(/\D/g,'')===phone):c.Email?.trim().toLowerCase()===email)}
let processed=0
for(const target of targets.values()){
 if(['created','existing'].includes(results[target.email]?.status)){processed++;continue}
 const existing=await find(target.email)
 if(existing.length===1){results[target.email]={...target,status:'existing',id:existing[0].id};await persist();processed++;continue}
 if(existing.length>1){results[target.email]={...target,status:'ambiguous-email',ids:existing.map((c:any)=>c.id)};await persist();processed++;continue}
 const samePhone=await find('',target.phone)
 if(samePhone.length){results[target.email]={...target,status:'existing-phone-different-email',contacts:samePhone.map((c:any)=>({id:c.id,email:c.Email??'',name:[c.First_Name,c.Last_Name].filter(Boolean).join(' ')}))};await persist();processed++;continue}
 if(results[target.email]?.status==='write-pending'){throw Error('Uncertain prior write for one contact; check before retrying')}
 results[target.email]={...target,status:'write-pending'};await persist()
 const payload={Last_Name:target.name||'Client - '+target.phone,Phone:target.phone,Email:target.email,Owner:{id:ownerIds.get(target.owner)||fallback}}
 let saved:any
 try{saved=await biginRequest('Contacts','POST',{data:[payload],trigger:[]})}catch(e){results[target.email].error='Create request failed; verify email before retry';await persist();throw e}
 const record=saved.data?.[0]
 if(record?.status!=='success'||!record.details?.id){results[target.email]={...target,status:'rejected',code:record?.code??'unknown'};await persist();throw Error('Contact creation was not confirmed: '+(record?.code??'unknown'))}
 results[target.email]={...target,status:'created',id:record.details.id};await persist();processed++
 if(processed%20===0)console.log(JSON.stringify({processed,total:targets.size,created:Object.values(results).filter((r:any)=>r.status==='created').length}))
}
let verified=0
for(const result of Object.values(results)as any[]){if(!['created','existing'].includes(result.status))continue;const rows=await find(result.email);if(rows.length!==1||rows[0].id!==result.id)throw Error('Contact verification failed');verified++}
const counts:Record<string,number>={};for(const result of Object.values(results)as any[])counts[result.status]=(counts[result.status]??0)+1
const coveredRows=(Object.values(results)as any[]).filter(r=>['created','existing'].includes(r.status)).reduce((sum,r)=>sum+r.rows,0)
const report={sourceFile:file,sourceHash:digest,failedDealRows:rows.length,uniqueContacts:targets.size,counts,verified,dealRowsNowLinkedByEmail:coveredRows,completedAt:new Date().toISOString(),directory:root,noDealsCreated:true}
await writeFile(resolve(root,'summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
