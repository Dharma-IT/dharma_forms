import{readFile,writeFile,mkdir}from'node:fs/promises'
import{biginRequest}from'../server/submissions.mjs'
import{csv}from'../src/migration.ts'
import{moneyCents,moneyText}from'../src/migration-line-items.ts'
const root=JSON.parse(await readFile('.migration-local/product-linking-latest.json','utf8')).directory
const matches:Record<string,any>=JSON.parse(await readFile(root+'/matches.json','utf8'))
const rows:string[][]=JSON.parse(await readFile(root+'/product-rows.json','utf8'))
const groups=new Map<string,string[][]>();for(const row of rows){if(!groups.has(row[7]))groups.set(row[7],[]);groups.get(row[7])!.push(row)}
await mkdir(root+'/before',{recursive:true});await mkdir(root+'/after',{recursive:true});await mkdir(root+'/writes',{recursive:true})
let ledger:Record<string,any>={};try{ledger=JSON.parse(await readFile(root+'/link-results.json','utf8'))}catch(e:any){if(e.code!=='ENOENT')throw e}
const save=()=>writeFile(root+'/link-results.json',JSON.stringify(ledger,null,2))
const signature=(id:string,price:any,quantity:any,discount:any)=>[id,Number(price).toFixed(2),Number(quantity).toFixed(2),Number(discount??0).toFixed(8)].join('|')
const desiredRows=(items:string[][])=>items.map(r=>({Product:{id:r[1]},List_Price:Number(r[3]),Quantity:Number(r[4]),Discount:Number(r[5])}))
const sourceSignatures=(items:string[][])=>items.map(r=>signature(r[1],r[3],r[4],r[5])+'|'+String(moneyCents(r[6]))).sort()
const currentSignatures=(items:any[])=>items.map(r=>signature(r.Product?.id,r.List_Price,r.Quantity,r.Discount)+'|'+String(moneyCents(String(r.Total??'')))).sort()
const same=(a:string[],b:string[])=>JSON.stringify(a)===JSON.stringify(b)
const planned:any[]=[]
for(const [sourceId,items]of groups){const match=matches[sourceId];if(match?.status!=='matched'){ledger[sourceId]={status:'review',reason:match?.status??'no parent match',rows:items.length};continue}
 if(items.some(row=>row[13]||!row[1]||Math.abs(Math.round(Number(Number(row[3]).toFixed(2))*Number(Number(row[4]).toFixed(2))*(1-Number(row[5])/100)*100)-Number(moneyCents(row[6])))>0)){ledger[sourceId]={status:'review',reason:'Product catalog or pricing issue in deal',rows:items.length,biginId:match.biginId};continue}
 if(items.length>100){ledger[sourceId]={status:'review',reason:'More than 100 product rows',rows:items.length,biginId:match.biginId};continue}
 planned.push({sourceId,items,match})
}
let next=0,completed=0;const ready:any[]=[]
async function preflight(){while(next<planned.length){const entry=planned[next++];const{sourceId,items,match}=entry
 let data:any
 if(!ledger[sourceId]){try{data=JSON.parse(await readFile(root+'/before/'+sourceId+'.json','utf8'))}catch(error:any){if(error.code!=='ENOENT')throw error}}
 if(!data)data=(await biginRequest('Pipelines/'+match.biginId)).data?.[0];if(!data)throw Error('Missing target deal')
 await writeFile(root+'/before/'+sourceId+'.json',JSON.stringify(data))
 if(data.$has_more?.Associated_Products){ledger[sourceId]={status:'review',reason:'Target associated products truncated',rows:items.length,biginId:match.biginId};continue}
 const products=data.Associated_Products??[]
 if(same(currentSignatures(products),sourceSignatures(items))){ledger[sourceId]={status:'already-associated',rows:items.length,biginId:match.biginId};continue}
 if(products.length){ledger[sourceId]={status:'review',reason:'Target already has a different product set',rows:items.length,biginId:match.biginId};continue}
 const s=match.source,target=match.target
 if(data.Deal_Name!==target.Deal_Name||data.Phone_Number!==target.Phone_Number||data.Pipeline?.id!==target.Pipeline?.id||moneyCents(String(data.Amount??''))!==moneyCents(String(target.Amount??''))||moneyCents(String(data.Installments??'0'))!==moneyCents(String(target.Installments??'0'))){ledger[sourceId]={status:'review',reason:'Deal changed after matching',rows:items.length,biginId:match.biginId};continue}
 if(moneyCents(String(data.Installments??'0'))!==moneyCents(s.installments||'0')){ledger[sourceId]={status:'review',reason:'Current installment differs from source',rows:items.length,biginId:match.biginId};continue}
 if(ledger[sourceId]?.status==='pending'){ledger[sourceId]={status:'review',reason:'Uncertain prior write; no duplicate attempt',rows:items.length,biginId:match.biginId};continue}
 const total=items.reduce((sum,row)=>sum+moneyCents(row[6])!,0n)
 ready.push({...entry,before:data,amount:moneyText(total),payload:{id:match.biginId,Associated_Products:desiredRows(items),Amount:0}})
 completed++;if(completed%250===0)console.log(JSON.stringify({phase:'product-preflight',checked:completed,total:planned.length}))
 }}
await Promise.all([preflight(),preflight(),preflight(),preflight(),preflight()]);await save()
console.log(JSON.stringify({phase:'product-preflight-complete',readyDeals:ready.length,sourceDeals:groups.size}))
let batchNumber=0
for(let offset=0;offset<ready.length;){const batch=ready.slice(offset,offset+(offset===0?1:50));for(const e of batch)ledger[e.sourceId]={status:'pending',biginId:e.match.biginId,rows:e.items.length};await save()
 const payload={data:batch.map(e=>e.payload),trigger:[]}
 await writeFile(root+'/writes/'+batchNumber+'-request.json',JSON.stringify(payload))
 let response:any
 try{response=await biginRequest('Pipelines','PUT',payload)}catch(error){await writeFile(root+'/write-error.json',JSON.stringify({batch:batchNumber,message:error instanceof Error?error.message:'Write failed'}));throw error}
 await writeFile(root+'/writes/'+batchNumber+'-response.json',JSON.stringify(response));batchNumber++
 if(response.data?.length!==batch.length)throw Error('Incomplete write response')
 for(let i=0;i<batch.length;i++){const e=batch[i],r=response.data[i];if(r.status==='success'&&r.details?.id===e.match.biginId)ledger[e.sourceId]={status:'written-awaiting-verification',biginId:e.match.biginId,rows:e.items.length};else ledger[e.sourceId]={status:'write-rejected',biginId:e.match.biginId,rows:e.items.length,code:r.code}}
 await save();
 if(offset===0&&batch.length){const e=batch[0];if(ledger[e.sourceId].status!=='written-awaiting-verification')throw Error('First association write rejected: '+ledger[e.sourceId].code);const data=(await biginRequest('Pipelines/'+e.match.biginId)).data?.[0];await writeFile(root+'/first-write-verification.json',JSON.stringify(data));if(!data||!same(currentSignatures(data.Associated_Products??[]),sourceSignatures(e.items))||moneyCents(String(data.Amount))!==moneyCents(e.amount)||data.Owner?.id!==e.before.Owner?.id||data.Contact_Name?.id!==e.before.Contact_Name?.id)throw Error('First association failed verification; remaining writes stopped')}
 offset+=batch.length;console.log(JSON.stringify({phase:'product-write',processed:offset,total:ready.length}))
}
next=0;let verified=0
async function verify(){while(next<ready.length){const e=ready[next++];if(ledger[e.sourceId]?.status!=='written-awaiting-verification')continue
 const data=(await biginRequest('Pipelines/'+e.match.biginId)).data?.[0];await writeFile(root+'/after/'+e.sourceId+'.json',JSON.stringify(data))
 const expectedPayable=moneyCents(e.amount)!+(moneyCents(String(e.before.Installments??'0'))??0n)
 const ok=data&&moneyCents(String(data.Total_Amount_Payable??''))===expectedPayable&&same(currentSignatures(data.Associated_Products??[]),sourceSignatures(e.items))&&moneyCents(String(data.Amount))===moneyCents(e.amount)&&data.Owner?.id===e.before.Owner?.id&&data.Contact_Name?.id===e.before.Contact_Name?.id&&moneyCents(String(data.Installments??'0'))===moneyCents(String(e.before.Installments??'0'))
 ledger[e.sourceId]={...ledger[e.sourceId],status:ok?'verified-associated':'verification-mismatch'}
 if(ok)verified++;if(verified%250===0&&verified)console.log(JSON.stringify({phase:'product-verification',verified,total:ready.length}))
 }}
await Promise.all([verify(),verify(),verify(),verify(),verify()]);await save()
const counts:Record<string,number>={},rowCounts:Record<string,number>={};for(const r of Object.values(ledger)){counts[r.status]=(counts[r.status]??0)+1;rowCounts[r.status]=(rowCounts[r.status]??0)+r.rows}
await writeFile(root+'/association-review.csv',csv([['HubSpot Deal ID','Bigin Deal ID','Status','Reason','Product Rows'],...Object.entries(ledger).filter(([,r])=>!['verified-associated','already-associated'].includes(r.status)).map(([id,r])=>[id,r.biginId??'',r.status,r.reason??r.code??'',String(r.rows)])]))
const summary={completedAt:new Date().toISOString(),dealCounts:counts,productRowCounts:rowCounts,directory:root,noHubSpotWrites:true};await writeFile(root+'/association-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
