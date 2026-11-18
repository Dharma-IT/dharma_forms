import{readFile,writeFile}from'node:fs/promises'
import{biginRequest}from'../server/submissions.mjs'
import{moneyCents,moneyText}from'../src/migration-line-items.ts'
const root=JSON.parse(await readFile('.migration-local/product-linking-latest.json','utf8')).directory
const matches=JSON.parse(await readFile(root+'/matches.json','utf8')),rows=JSON.parse(await readFile(root+'/product-rows.json','utf8')),ledger=JSON.parse(await readFile(root+'/link-results.json','utf8'))
const groups=new Map<string,string[][]>();for(const row of rows){if(!groups.has(row[7]))groups.set(row[7],[]);groups.get(row[7])!.push(row)}
for(const[id,items]of groups){if(ledger[id]||matches[id]?.status!=='matched'||items.length<2||items.some(row=>row[13]||!row[1]))continue
 const target=matches[id].biginId;const before=(await biginRequest('Pipelines/'+target)).data[0]
 if(before.Associated_Products?.length)continue
 const total=moneyText(items.reduce((n,row)=>n+moneyCents(row[6])!,0n))
 const payload={data:[{id:target,Amount:0,Associated_Products:items.map(row=>({Product:{id:row[1]},List_Price:Number(row[3]),Quantity:Number(row[4]),Discount:Number(row[5])}))}],trigger:[]}
 await writeFile(root+'/zero-base-check-before.json',JSON.stringify(before));await writeFile(root+'/zero-base-check-request.json',JSON.stringify(payload))
 ledger[id]={status:'pending',biginId:target,rows:items.length};await writeFile(root+'/link-results.json',JSON.stringify(ledger))
 const response=await biginRequest('Pipelines','PUT',payload);await writeFile(root+'/zero-base-check-response.json',JSON.stringify(response))
 if(response.data[0].status!=='success')throw Error('Product test rejected')
 const after=(await biginRequest('Pipelines/'+target)).data[0];await writeFile(root+'/zero-base-check-after.json',JSON.stringify(after))
 const ok=moneyCents(String(after.Amount))===moneyCents(total)&&after.Associated_Products?.length===items.length&&after.Owner?.id===before.Owner?.id&&after.Contact_Name?.id===before.Contact_Name?.id
 if(!ok){await biginRequest('Pipelines/'+target,'PUT',{data:[{Amount:Number(total)}],trigger:[]});throw Error('Zero base behavior not verified; Amount corrected, stopped')}
 ledger[id]={status:'verified-associated',biginId:target,rows:items.length};await writeFile(root+'/link-results.json',JSON.stringify(ledger));console.log(JSON.stringify({verifiedZeroBase:true,productRows:items.length,amount:after.Amount,expected:total,installments:after.Installments,payable:after.Total_Amount_Payable}));break
}
