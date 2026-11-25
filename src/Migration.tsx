import MigrationSpecialExport from './MigrationSpecialExport'
import { useEffect, useState } from 'react'
import './Migration.css'

type LocalStatus = { dateRange?: { start: string; through: string; timezone: string }; duplicateCheck?: { sourceRows: number; heldForReview: number; ready: number }; status: string; files?: string[]; ready?: Record<string, number>; reviewByPipeline?: Record<string, number>; selected?: number; completedAt?: string; productAssociation?: { pipelines: Record<string, { attachedRows: number; attachedDeals: number; pendingRows: number; pendingDeals: number }> } }
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
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Could not load migration progress. Retryingâ€¦') }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const slug = pipeline.toLowerCase().replaceAll(' ', '-')
  const files = status?.files?.filter(file => file.startsWith(slug+'-')) ?? []
  const ready = status?.ready?.[pipeline] ?? 0
  const review = status?.reviewByPipeline?.[pipeline] ?? 0
  const associations = status?.productAssociation?.pipelines[pipeline]
  return <main className="migration"><header><span className="migration-eyebrow">HUBSPOT â†’ BIGIN</span><h1>Pipeline migration</h1><p>Your deals are fetched directly from HubSpot. Choose a pipeline and download one file at a time.</p></header>
    {status?.dateRange && <section><h2>Incremental export</h2><p>Created from {new Date(status.dateRange.start).toLocaleString('en-US', {timeZone: status.dateRange.timezone})} through {new Date(status.dateRange.through).toLocaleString('en-US', {timeZone: status.dateRange.timezone})} (Eastern Time).</p>{status.duplicateCheck && <><p>{status.duplicateCheck.sourceRows} source deals checked against live Bigin records. {status.duplicateCheck.ready} deals are ready; {status.duplicateCheck.heldForReview} possible duplicates are withheld for review. Repeat purchases may be legitimate; compare them before importing.</p><a href="/__local-migration/files/duplicate-review.csv" download>Download possible duplicate review</a></>}</section>}
    <div className="migration-tabs" role="tablist" aria-label="Pipeline">{pipelines.map(name => <button role="tab" aria-selected={pipeline === name} aria-controls="pipeline-downloads" id={'tab-'+name.toLowerCase().replaceAll(' ','-')} key={name} onClick={() => setPipeline(name)}>{name}</button>)}</div>
    <MigrationSpecialExport key={pipeline} pipeline={pipeline} />
    <section id="pipeline-downloads" role="tabpanel" aria-labelledby={'tab-'+slug}><span className="migration-eyebrow">{pipeline === 'New Leads' ? 'HUBSPOT: NEW LEADS 2025' : 'HUBSPOT: CUSTOMER SERVICE'}</span><h2>{pipeline}</h2>
      {error && <p role="alert">{error}</p>}
      {!status ? <p role="status">Connecting to the local migrationâ€¦</p> : status.status !== 'ready' ? <div role="status"><h3>Preparing your pipeline filesâ€¦</h3><p>Deals are downloaded. Contact details and owners are being checked before the clean files are released.</p><p>Each CSV will contain up to <strong>10,000 {pipeline} deals</strong>. This page updates automatically.</p></div> : <><div className="migration-stats"><strong>{ready.toLocaleString()} ready deals</strong><span>{files.length} CSV files</span><span>{review.toLocaleString()} need review</span></div>
      <p>Import these files into Bigin's <strong>{pipeline}</strong> pipeline, one at a time. Pipeline and Sub Pipeline columns are omitted; Stage is kept.</p>
      {files.length ? files.map((file,index) => <div className="migration-export" key={file}><div><h3>{pipeline} Â· File {index+1}</h3><p>{Math.min(10000, ready-index*10000).toLocaleString()} deals Â· CSV</p></div><a className="migration-file" href={'/__local-migration/files/'+file} download>Download File {index+1}</a></div>) : <p>No deals are ready for import. Check the review file for this pipeline.</p>}
      <p><a href={'/__local-migration/files/'+slug+'-review.csv'} download>Download {pipeline} review file</a> Â· <a href={'/__local-migration/files/'+slug+'-audit.csv'} download>Download {pipeline} audit trail</a></p>
      {associations && <div className="migration-stats"><strong>{associations.attachedRows.toLocaleString()} product rows attached to {associations.attachedDeals.toLocaleString()} deals</strong><span>{associations.pendingRows.toLocaleString()} product rows remain in review</span></div>}
      <p><a href={'/__local-migration/files/'+slug+'-associated-products.csv'} download>{associations ? 'Download remaining product association review' : 'Download product rows for association'}</a>{associations && <> ? <a href={'/__local-migration/files/'+slug+'-associated-products-completed.csv'} download>Completed product associations (audit only)</a></>} ? <a href={'/__local-migration/files/'+slug+'-financial-audit.csv'} download>Download amount and installment audit</a> ? <a href={'/__local-migration/files/'+slug+'-products.csv'} download>All product details</a></p>
      <p className="migration-muted">Product rows preserve individual prices, quantities, discounts and totals. Completed associations are already saved in Bigin and must not be imported again. For remaining rows, fill Parent ID with the corresponding Bigin Deal ID and resolve any Product Review Issues. HubSpot Deal ID is a separate source identifier; never map it to Bigin's system Deal ID. Repeat purchases remain separate deals under the same client.</p>
      <p className="migration-muted">Excluded deals may have a missing phone, unsupported dropdown value. The review file lists the reason for each deal. Review and audit files are for checking only; use the numbered CSVs for deal imports.</p></>}
    </section>
    <section><h2>Migration rules</h2><p>Existing owners are preserved when matched to an active Bigin user. Unassigned deals and unmatched existing owners go to Carolina Fernandes. Original owner details are preserved in the audit files. When multiple contacts are linked, the first linked contact is used.</p><p>Product uses the HubSpot product selections when present, otherwise WLI. Amount uses the net total of actual product rows when complete and valid; otherwise the original HubSpot Amount is preserved. HubSpot Installment fee maps to the Installments currency field; missing fees export as 0.00. Total Amount Payable is calculated in Bigin as Amount + Installments; enable blank inputs as zero in both formulas. NEW SALE becomes Sellers. Sellers, CS and Nutri name prefixes are kept. Names without a recognized prefix are allowed. Missing usable deal names become Client - [phone number] when a number is available. Blank Sources are allowed; Source values that do not match Bigin are left blank. HubSpot's Paid date (all pipelines) maps to Bigin's Paid Date. Missing paid and closing dates use the reference placeholder 2020-01-01.</p><p className="migration-muted">Downloads keep the two pipelines separate. Nothing is imported into Bigin automatically. Match owner and contact fields carefully when importing.</p></section>
  </main>
}





