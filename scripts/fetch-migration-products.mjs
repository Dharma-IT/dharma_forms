import {mkdir,readFile,writeFile} from 'node:fs/promises'
const root='.migration-local/product-enrichment';await mkdir(root,{recursive:true})
const k=Object.keys(process.env).find(k=>/HUBSPOT.*(TOKEN|KEY)/i.test(k))
const headers={Authorization:'Bearer '+process.env[k],'Content-Type':'application/json'}
const propertyResponse=await fetch('https://api.hubapi.com/crm/v3/properties/deals',{headers});if(!propertyResponse.ok)throw Error('Properties HTTP '+propertyResponse.status)
const metadata=(await propertyResponse.json()).results
const fields=['nombre_producto_1','valor_producto_1','cantidad_producto_1','tipo_de_tratamiento','desired_treatment','desired_treatment_1','desired_treatment_2','desired_treatment_3','desired_treatment_form','desired_treatment_single_purchase_1','value_desired_treatment_1','value_desired_treatment_2','value_desired_treatment_3','value_desired_treatment_form','value_desired_treatment_single_purchase_1','quantity_desired_treatment_1','quantity_desired_treatment_2','quantity_desired_treatment_3','quantity_desired_treatment_form','quantity_desired_treatment_single_purchase_1'].filter(n=>metadata.some(f=>f.name===n))
await writeFile(root+'/properties.json',JSON.stringify(metadata.filter(f=>fields.includes(f.name))))
const productFields=['desired_treatment','desired_treatment_1','desired_treatment_2','desired_treatment_3','desired_treatment_form','desired_treatment_single_purchase_1','nombre_producto_1','tipo_de_tratamiento']
const cutoff=JSON.parse(await readFile('.migration-local/search-pages/cutoff.json','utf8')).cutoff
let gate=Promise.resolve()
async function search(body){const previous=gate;let release;gate=new Promise(r=>release=r);await previous;const pending=(async()=>{for(let a=0;a<6;a++){const r=await fetch('https://api.hubapi.com/crm/v3/objects/deals/search',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(r.ok)return r.json();if(r.status!==429&&r.status<500)throw Error('Product read HTTP '+r.status);await new Promise(r=>setTimeout(r,1500*(a+1)))}throw Error('Product read retries exhausted')})();pending.catch(()=>{});await new Promise(r=>setTimeout(r,350));release();return pending}
const tasks=[]
async function partition(names,low,high){
 const filterGroups=names.map(name=>({filters:[{propertyName:'pipeline',operator:'IN',values:['693198644','709161049']},{propertyName:name,operator:'HAS_PROPERTY'},{propertyName:'createdate',operator:'GTE',value:String(low)},{propertyName:'createdate',operator:'LT',value:String(high)}]}))
 const file=`${root}/count-${names[0]}-${low}-${high}.json`;let result
 try{result=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;result=await search({filterGroups,limit:1,properties:[]});await writeFile(file,JSON.stringify({total:result.total}))}
 if(result.total>9000){const mid=Math.floor((low+high)/2);if(mid===low)throw Error('Product partition too dense');await partition(names,low,mid);await partition(names,mid,high)}else if(result.total)tasks.push({names,low,high,filterGroups})
}
for(let n=0;n<productFields.length;n+=4)await partition(productFields.slice(n,n+4),0,cutoff)
console.log(JSON.stringify({phase:'product-partitions',partitions:tasks.length}))
const deals=new Map();let next=0,pages=0
async function worker(){while(next<tasks.length){const task=tasks[next++];let after='';const cursors=new Set();do{if(cursors.has(after))throw Error('Repeated product cursor');cursors.add(after);const file=`${root}/data-${task.names[0]}-${task.low}-${task.high}-${after||'start'}.json`;let page;try{page=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;page=await search({filterGroups:task.filterGroups,limit:200,properties:fields,sorts:['hs_object_id'],...(after?{after}:{})});await writeFile(file,JSON.stringify(page))}for(const d of page.results)deals.set(d.id,d.properties);after=page.paging?.next?.after??'';pages++;if(pages%50===0)console.log(JSON.stringify({phase:'product-data',deals:deals.size,pages}))}while(after)}}
await Promise.all([worker(),worker(),worker()])
await writeFile(root+'/deals.json',JSON.stringify(Object.fromEntries(deals)))
console.log(JSON.stringify({phase:'product-data-complete',deals:deals.size,pages}))
