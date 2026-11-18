import {mkdir,writeFile} from 'node:fs/promises'
const key=Object.keys(process.env).find(k=>/HUBSPOT.*(TOKEN|KEY)/i.test(k))
async function count(filters){for(let a=0;a<5;a++){const r=await fetch('https://api.hubapi.com/crm/v3/objects/deals/search',{method:'POST',headers:{Authorization:'Bearer '+process.env[key],'Content-Type':'application/json'},body:JSON.stringify({filterGroups:[{filters}],limit:1,properties:[]})});if(r.status===429){await new Promise(r=>setTimeout(r,1500));continue}if(!r.ok)throw Error('HubSpot count HTTP '+r.status);const j=await r.json();await new Promise(r=>setTimeout(r,250));return j.total}throw Error('Count retries exhausted')}
const rows=[]
for(let month=5;month<=11;month++){
 const start=Date.parse(`2026-${String(month).padStart(2,'0')}-01T00:00:00+08:00`)
 const end=month===11?Date.parse('2026-11-19T00:00:00+08:00'):Date.parse(`2026-${String(month+1).padStart(2,'0')}-01T00:00:00+08:00`)
 const row={month:`2026-${String(month).padStart(2,'0')}`,through:month===11?'November 18 inclusive':'full month',pipelines:{}}
 for(const [id,name]of [['693198644','New Leads'],['709161049','Customer Service']]){
  const base={propertyName:'pipeline',operator:'EQ',value:id}
  const range=field=>[{propertyName:field,operator:'GTE',value:String(start)},{propertyName:field,operator:'LT',value:String(end)}]
  row.pipelines[name]={newDealsWithEvaluation:await count([base,...range('createdate'),{propertyName:'evaluation_date_and_hour_2',operator:'HAS_PROPERTY'}]),evaluationsScheduledInMonth:await count([base,...range('evaluation_date_and_hour_2')])}
 }
 rows.push(row);console.log(JSON.stringify(row))
}
await mkdir('.migration-local/cost-analysis',{recursive:true})
await writeFile('.migration-local/cost-analysis/hubspot-monthly-counts.json',JSON.stringify({checkedAt:new Date().toISOString(),timezone:'Asia/Manila',definition:'New deals created in each month with Evaluation date and hour populated; appointment volume separately grouped by evaluation date. Counts are deals, not deduplicated clients.',rows},null,2))
