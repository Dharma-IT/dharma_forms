import{readFile,writeFile}from'node:fs/promises'
import{parseCsv,csv}from'../src/migration.ts'
import{biginRequest}from'../server/submissions.mjs'
const products:any[]=[]
for(let page=1;;page++){const response=await biginRequest('Products?fields=Product_Name,Product_Code,Unit_Price&per_page=200&page='+page);products.push(...response.data??[]);if(!response.info?.more_records)break;if(page>=10)throw Error('Catalog pagination requires a token')}
const normalize=(value:string)=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ')
const missing=new Map<string,number>();let matched=0,total=0,financial=0
for(const slug of ['new-leads','customer-service']){
 const path='.migration-local/exports/'+slug+'-associated-products.csv'
 const [headers,...rows]=parseCsv(await readFile(path,'utf8'))
 for(const row of rows){
  total++;const candidates=products.filter(product=>normalize(product.Product_Name)===normalize(row[2]))
  const issues=row[13].split('; ').filter(issue=>issue&&!['Product must be added to Bigin catalog','Ambiguous Bigin product name'].includes(issue))
  if(candidates.length===1){row[1]=candidates[0].id;matched++}else{row[1]='';issues.push(candidates.length?'Ambiguous Bigin product name':'Product must be added to Bigin catalog');missing.set(row[2],(missing.get(row[2])??0)+1)}
  if(issues.some(issue=>!/Product must be added|Ambiguous Bigin product/.test(issue)))financial++
  row[13]=issues.join('; ')
 }
 await writeFile(path,csv([headers,...rows]))
}
await writeFile('.migration-local/line-items/bigin-products.json',JSON.stringify(products))
await writeFile('.migration-local/exports/product-catalog-matching.json',JSON.stringify({checkedAt:new Date().toISOString(),rows:total,matched,missing:total-matched,financialReviewRows:financial,missingProducts:[...missing].map(([name,rows])=>({name,rows})),parentDealIdsFilled:false},null,2))
console.log(JSON.stringify({rows:total,matched,missing:total-matched,missingProductNames:missing.size,financialReviewRows:financial}))
