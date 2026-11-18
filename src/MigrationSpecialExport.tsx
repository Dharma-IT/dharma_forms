import { useState } from 'react'
import { exportSpecialCsv, prepareSpecialExport } from './migration-special-export'
import type { SpecialResult } from './migration-special-export'
function download(name:string,headers:string[],rows:string[][]){const url=URL.createObjectURL(new Blob([exportSpecialCsv(headers,rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export default function MigrationSpecialExport({pipeline}:{pipeline:string}){
 const [result,setResult]=useState<SpecialResult|null>(null),[error,setError]=useState(''),[source,setSource]=useState(''),[busy,setBusy]=useState(false),[imported,setImported]=useState(false)
 const slug=pipeline.toLowerCase().replaceAll(' ','-')
 async function load(file?:File){
  if(!file)return
  setBusy(true);setError('');setResult(null);setImported(false);setSource('')
  try{
   if(file.size>30*1024*1024)throw Error('Split files larger than 30 MB before uploading.')
   let knownEmails:string[]=[]
   try{const response=await fetch('/__local-migration/special-known-contacts',{cache:'no-store'});if(response.ok&&response.headers.get('content-type')?.includes('application/json'))knownEmails=(await response.json()).emails??[]}catch{/* Contact imports can skip duplicates by Email. */}
   const prepared=prepareSpecialExport(await file.text(),knownEmails)
   setResult(prepared);setSource(file.name)
  }catch(error){setError(error instanceof Error?error.message:'Unable to read the skipped-records CSV.')}
  finally{setBusy(false)}
 }
 return <section aria-labelledby="special-export-title"><span className="migration-eyebrow">MISSING CONTACTS FROM BIGIN IMPORT</span><h2 id="special-export-title">Special Export · {pipeline}</h2><p>Load Bigin’s skipped-records CSV. Import the missing contacts first, then retry only the failed deals.</p>
 <label className="migration-upload">Skipped-records CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event=>{void load(event.target.files?.[0]);event.target.value=''}}/></label>
 {busy&&<p role="status">Preparing exports...</p>}{error&&<p role="alert">{error}</p>}
 {result&&<><p>{source}</p><div className="migration-stats"><strong>{result.contacts.length} contacts to import</strong><span>{result.deals.length} failed deals</span><span>{result.duplicates} repeated contacts removed</span>{result.existing>0&&<span>{result.existing} already-created contacts omitted</span>}</div>
 <h3>1. Import missing contacts</h3><p>Import these into Bigin Contacts. Map Name to Last Name, Phone to Phone and Email to Email. Skip existing contacts by Email.</p>
 {Array.from({length:Math.ceil(result.contacts.length/10000)},(_,batch)=><button key={batch} onClick={()=>download(`${slug}-special-contacts-${batch+1}.csv`,result.contactHeaders,result.contacts.slice(batch*10000,(batch+1)*10000))}>Download Special Export {batch+1} ({Math.min(10000,result.contacts.length-batch*10000)} contacts)</button>)}
 {!result.contacts.length&&<p>No new contacts need preparing from these missing-parent errors.</p>}
 {(result.excluded>0||result.otherErrors>0)&&<p role="status">{result.excluded} missing-parent rows could not produce a matching contact. {result.otherErrors} failed deals have other errors to fix before retrying.</p>}
 <h3>2. Retry failed deals</h3><label className="migration-check"><input type="checkbox" checked={imported} onChange={event=>setImported(event.target.checked)}/> I have imported the contact file successfully (or verified the contacts already exist).</label>
 <p>Retry files keep every failed deal, including repeat purchases. Original amounts, installments, owners, products and stages are preserved. Row Number, Errors and Warnings are removed.</p>
 {Array.from({length:Math.ceil(result.deals.length/10000)},(_,batch)=><button disabled={!imported} key={batch} onClick={()=>download(`${slug}-skipped-deals-${batch+1}.csv`,result.dealHeaders,result.deals.slice(batch*10000,(batch+1)*10000))}>Download Skipped Export {batch+1} ({Math.min(10000,result.deals.length-batch*10000)} deals)</button>)}
 <p className="migration-muted">Import the retry files into {pipeline}. These files contain only rows with errors, so successfully imported deals are not repeated. Uploads are processed in this tab; refreshing clears them. Nothing is created in Bigin by this tool.</p>
 </>}
 </section>
}
