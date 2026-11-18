import assert from 'node:assert/strict'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {canonicalPerson,parseCsv,columns} from '../src/migration.ts'
import {getFormMetadata} from '../server/submissions.mjs'
const root='.migration-local/exports/'
const summary=JSON.parse(await readFile(root+'summary.json','utf8'))
const source=new Map()
for(const file of (await readdir('.migration-local/search-pages')).filter(f=>f.startsWith('data-'))){for(const d of JSON.parse(await readFile('.migration-local/search-pages/'+file,'utf8')).results)source.set(d.id,d.properties)}
const key=Object.keys(process.env).find(k=>/HUBSPOT.*(TOKEN|KEY)/i.test(k))
const response=await fetch('https://api.hubapi.com/crm/v3/properties/deals',{headers:{Authorization:'Bearer '+process.env[key!]}})
assert.equal(response.status,200)
const props=(await response.json()).results
const agent=props.find((p:any)=>p.name==='agent_lead_management')
const metadata=await getFormMetadata()
const audit=parseCsv(await readFile(root+'audit.csv','utf8')).slice(1)
const report:any={pipelines:{},sourceFields:{product:props.some((p:any)=>p.name==='product'),installment:props.some((p:any)=>p.name==='installment')},columns}
for(const pipeline of ['New Leads','Customer Service']){
 const slug=pipeline.toLowerCase().replaceAll(' ','-')
 const entries:any[]=[]
 const readyIds=audit.filter(r=>r[1]===pipeline&&r[6]==='ready').map(r=>r[0])
 let offset=0
 for(const file of summary.files.filter((f:string)=>f.startsWith(slug+'-'))){for(const row of parseCsv(await readFile(root+file,'utf8')).slice(1))entries.push({id:readyIds[offset++],row,ready:true})}
 for(const row of parseCsv(await readFile(root+slug+'-review.csv','utf8')).slice(1))entries.push({id:row[0],row:row.slice(2),ready:false})
 let populated=0,readyPopulated=0,checked=0
 const coverage=columns.map((name,index)=>({field:name,populated:entries.filter(e=>e.row[index]).length,readyPopulated:entries.filter(e=>e.ready&&e.row[index]).length}))
 const layout=metadata.pipelines.find((p:any)=>p.name===pipeline)!
 const agentField=layout.fields.find((f:any)=>f.api_name==='Agent_Lead_Management')!
 for(const entry of entries){
  const value=source.get(entry.id).agent_lead_management??''
  const expected=value?value.split(';').map((v:string)=>agent.options.find((o:any)=>o.value===v)?.label??v).join(';'):''
  assert.equal(canonicalPerson(entry.row[4]).toLowerCase(),canonicalPerson(expected).toLowerCase())
  if(value){populated++;if(entry.ready)readyPopulated++}
  if(entry.ready&&entry.row[4]){assert.ok(agentField.pick_list_values.some((v:any)=>(v.display_value||v.actual_value)===entry.row[4]));checked++}
 }
 report.pipelines[pipeline]={total:entries.length,agentLeadManagement:{sourcePopulated:populated,sourceBlank:entries.length-populated,readyPopulated,biginOptionsVerified:checked},coverage,missingTargetFields:columns.filter(c=>!['Email'].includes(c)&&!layout.fields.some((f:any)=>f.field_label===c))}
}
await writeFile(root+'field-coverage.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))

