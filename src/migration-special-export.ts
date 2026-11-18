import { csv, parseCsv } from './migration.ts'
export type SpecialResult = { contactHeaders: string[]; contacts: string[][]; dealHeaders: string[]; deals: string[][]; missingParentRows: number; duplicates: number; existing: number; excluded: number; otherErrors: number }
export function prepareSpecialExport(text: string, knownEmails: string[] = []): SpecialResult {
  const [headers,...rows]=parseCsv(text)
  const normalized=headers.map(h=>h.trim().toLowerCase())
  if(new Set(normalized).size!==normalized.length)throw Error('The CSV contains duplicate column headings.')
  const field=(name:string)=>normalized.indexOf(name.toLowerCase())
  const errors=field('Errors'),phoneIndex=field('Phone Number'),emailIndex=field('Email'),nameIndex=field('Deal Name')
  if([errors,phoneIndex,emailIndex,nameIndex].some(i=>i<0))throw Error('Choose Bigin’s skipped-records CSV with Errors, Deal Name, Phone Number and Email columns.')
  const known=new Set(knownEmails.map(email=>email.trim().toLowerCase()))
  const seen=new Set<string>();const contacts:string[][]=[];const deals:string[][]=[]
  let missingParentRows=0,duplicates=0,existing=0,excluded=0,otherErrors=0
  const keep=headers.map((_,i)=>i).filter(i=>!['errors','warnings','row number','pipeline','sub pipeline','sub-pipeline'].includes(normalized[i]))
  for(const row of rows){
    const error=row[errors].trim();if(!error)continue
    deals.push(keep.map(i=>row[i]))
    if(!/matching parent record/i.test(error)||!/\bemail\b/i.test(error)){otherErrors++;continue}
    missingParentRows++
    const email=row[emailIndex].trim().toLowerCase()
    const dummy=email.match(/^(\d+)@dummy\.com$/)
    const phone=row[phoneIndex].replace(/\D/g,'')||dummy?.[1]||''
    const name=row[nameIndex].trim().replace(/^(?:sellers?|cs|nutri|new\s+sale)\s*[-–—:]\s*/i,'').trim()|| (phone?'Client - '+phone:'')
    // Preserve the failed lookup key exactly, so retrying the deal finds its parent.
    if(!name||!phone||!dummy||dummy[1]!==phone){excluded++;continue}
    if(seen.has(email)){duplicates++;continue}seen.add(email)
    if(known.has(email)){existing++;continue}
    contacts.push([name,phone,email])
  }
  return {contactHeaders:['Name','Phone','Email'],contacts,dealHeaders:keep.map(i=>headers[i]),deals,missingParentRows,duplicates,existing,excluded,otherErrors}
}
export function exportSpecialCsv(headers:string[],rows:string[][]){return csv([headers,...rows])}
