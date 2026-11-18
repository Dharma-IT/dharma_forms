import{readFile,readdir,writeFile}from'node:fs/promises'
import{parseCsv,csv}from'../src/migration.ts'
const key=Object.keys(process.env).find(k=>/HUBSPOT.*(TOKEN|KEY)/i.test(k))!
const rows=parseCsv(await readFile('.migration-local/exports/review.csv','utf8')).slice(1).filter(r=>r[1].includes('Missing phone'))
const audit=new Map(parseCsv(await readFile('.migration-local/exports/audit.csv','utf8')).slice(1).map(r=>[r[0],r]))
const contacts=new Map<string,any>()
for(const file of await readdir('.migration-local/contacts')){if(file.endsWith('.json'))for(const c of JSON.parse(await readFile('.migration-local/contacts/'+file,'utf8')).results??[])contacts.set(c.id,c.properties)}
const deals=new Map<string,string>();let offset=0
async function worker(){while(offset<rows.length){const batch=rows.slice(offset,offset+100);offset+=100;let result:any;for(let a=0;a<5;a++){const r=await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read',{method:'POST',headers:{Authorization:'Bearer '+process.env[key],'Content-Type':'application/json'},body:JSON.stringify({properties:['email'],inputs:batch.map(row=>({id:row[0]}))}),signal:AbortSignal.timeout(30000)});if(r.status===429||r.status>=500){await new Promise(r=>setTimeout(r,1500));continue}if(!r.ok)throw Error('HubSpot read HTTP '+r.status);result=await r.json();break}if(!result)throw Error('Email read exhausted retries');for(const d of result.results??[])deals.set(d.id,d.properties.email?.trim()??'')}}
await Promise.all([worker(),worker(),worker()])
if(deals.size!==rows.length)throw Error('Incomplete deal email response')
const out:Record<string,any>={};const report:string[][]=[]
for(const row of rows){const a=audit.get(row[0])!;const p=a[1];out[p]??={missingPhone:0,withDealEmail:0,withLinkedContactEmail:0,withEitherEmail:0,withoutAnyEmail:0};const linked=[...new Set((a[4]||'').split(';').filter(Boolean).map(id=>contacts.get(id)?.email?.trim()).filter(Boolean))];const direct=deals.get(row[0])!;out[p].missingPhone++;if(direct)out[p].withDealEmail++;if(linked.length)out[p].withLinkedContactEmail++;if(direct||linked.length)out[p].withEitherEmail++;else out[p].withoutAnyEmail++;report.push([row[0],p,row[2],direct,linked.join('; '),row[1]])}
await writeFile('.migration-local/exports/missing-phone-email-check.csv',csv([['HubSpot Deal ID','Pipeline','Deal Name','Deal Email (Correo)','Linked Contact Emails','Review Issues'],...report]))
console.log(JSON.stringify(out,null,2))
