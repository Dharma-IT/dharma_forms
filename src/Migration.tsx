import { useEffect, useState } from 'react'
import './Migration.css'

type LocalStatus = { status: string; files?: string[]; ready?: Record<string, number>; reviewByPipeline?: Record<string, number>; selected?: number; completedAt?: string }
const pipelines = ['New Leads', 'Customer Service']
export default function Migration() {
  const [pipeline, setPipeline] = useState('New Leads')
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const response = await fetch('/__local-migration/status', { cache: 'no-store' })
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('Open this page on the local migration server to access your HubSpot exports.')
        const value = await response.json() as LocalStatus
        if (active) { setStatus(value); setError('') }
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Could not load migration progress. Retrying…') }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const slug = pipeline.toLowerCase().replaceAll(' ', '-')
  const files = status?.files?.filter(file => file.startsWith(slug+'-')) ?? []
  const ready = status?.ready?.[pipeline] ?? 0
  const review = status?.reviewByPipeline?.[pipeline] ?? 0
  return <main className="migration"><header><span className="migration-eyebrow">HUBSPOT → BIGIN</span><h1>Pipeline migration</h1><p>Your deals are fetched directly from HubSpot. Choose a pipeline and download one file at a time.</p></header>
    <div className="migration-tabs" role="tablist" aria-label="Pipeline">{pipelines.map(name => <button role="tab" aria-selected={pipeline === name} aria-controls="pipeline-downloads" id={'tab-'+name.toLowerCase().replaceAll(' ','-')} key={name} onClick={() => setPipeline(name)}>{name}</button>)}</div>
    <section id="pipeline-downloads" role="tabpanel" aria-labelledby={'tab-'+slug}><span className="migration-eyebrow">{pipeline === 'New Leads' ? 'HUBSPOT: NEW LEADS 2025' : 'HUBSPOT: CUSTOMER SERVICE'}</span><h2>{pipeline}</h2>
      {error && <p role="alert">{error}</p>}
      {!status ? <p role="status">Connecting to the local migration…</p> : status.status !== 'ready' ? <div role="status"><h3>Preparing your pipeline files…</h3><p>Deals are downloaded. Contact details and owners are being checked before the clean files are released.</p><p>Each CSV will contain up to <strong>10,000 {pipeline} deals</strong>. This page updates automatically.</p></div> : <><div className="migration-stats"><strong>{ready.toLocaleString()} ready deals</strong><span>{files.length} CSV files</span><span>{review.toLocaleString()} need review</span></div>
      <p>Import these files into Bigin’s <strong>{pipeline}</strong> pipeline, one at a time.</p>
      {files.length ? files.map((file,index) => <div className="migration-export" key={file}><div><h3>{pipeline} · File {index+1}</h3><p>{Math.min(10000, ready-index*10000).toLocaleString()} deals · CSV</p></div><a className="migration-file" href={'/__local-migration/files/'+file} download>Download File {index+1}</a></div>) : <p>No deals are ready for import. Check the review file for this pipeline.</p>}
      <p><a href={'/__local-migration/files/'+slug+'-review.csv'} download>Download {pipeline} review file</a> · <a href={'/__local-migration/files/'+slug+'-audit.csv'} download>Download {pipeline} audit trail</a></p>
      <p className="migration-muted">Excluded deals may have an unmatched existing owner, missing phone, unsupported dropdown value or ambiguous contact link. The review file lists the reason for each deal. Review and audit files are for checking only; use the numbered CSVs for deal imports.</p></>}
    </section>
    <section><h2>Migration rules</h2><p>Existing owners are preserved when matched to an active Bigin user. Unassigned deals go to Carolina Fernandes. Unmatched existing owners go to review.</p><p>Sellers, CS and Nutri name prefixes are kept. HubSpot’s Paid date (all pipelines) maps to Bigin’s Paid Date. Missing paid and closing dates use the reference placeholder 2020-01-01.</p><p className="migration-muted">Downloads keep the two pipelines separate. Nothing is imported into Bigin automatically. Match owner and contact fields carefully when importing.</p></section>
  </main>
}

