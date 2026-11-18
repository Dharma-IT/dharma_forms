import { useMemo, useState } from 'react'
import { aliases, cleanRow, columns, csv, guess, parseCsv } from './migration'
import './Migration.css'

function download(name: string, rows: string[][]) {
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function Migration() {
  const [data, setData] = useState<string[][]>([])
  const [mapping, setMapping] = useState<number[]>([])
  const [pipelineColumn, setPipelineColumn] = useState(-1)
  const [selected, setSelected] = useState(['', ''])
  const [single, setSingle] = useState('')
  const [placeholders, setPlaceholders] = useState(true)
  const [error, setError] = useState('')
  const [filename, setFilename] = useState('')
  const [busy, setBusy] = useState(false)
  const headers = data[0] ?? []
  const values = useMemo(() => [...new Set(data.slice(1).map(row => row[pipelineColumn]?.trim()).filter(Boolean))].sort(), [data, pipelineColumn])
  const result = useMemo(() => {
    const groups: string[][][] = [[], []]; const review: string[][] = []; let outside = 0, defaults = 0
    data.slice(1).forEach((source, index) => {
      const pipeline = pipelineColumn < 0 ? single : source[pipelineColumn].trim()
      const group = pipelineColumn < 0 ? ['New Leads','Customer Service'].indexOf(single) : selected.indexOf(pipeline)
      if (group < 0 || !pipeline) { outside++; return }
      const cleaned = cleanRow(source, mapping, placeholders)
      if (cleaned.issues.length) review.push([String(index + 2), cleaned.issues.join('; '), ...source])
      else { groups[group].push(cleaned.row); if ([7,8,11].some(i => !(source[mapping[i]] ?? '').trim())) defaults++ }
    })
    return { groups, review, outside, defaults }
  }, [data, mapping, pipelineColumn, single, selected, placeholders])
  const ready = mapping[0] >= 0 && mapping[3] >= 0 && (pipelineColumn < 0 ? !!single : selected.some(Boolean))
  async function upload(file?: File) {
    if (!file) return
    setBusy(true); setError(''); setData([]); setFilename('')
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Please split exports larger than 30 MB before uploading.')
      if (!/\.(csv|tsv)$/i.test(file.name)) throw new Error('Upload a CSV or TSV export. Save Excel files as CSV first.')
      const parsed = parseCsv(await file.text()); const h = parsed[0]
      const p = guess(h,['pipeline','deal pipeline']); const distinct = [...new Set(parsed.slice(1).map(row => row[p]?.trim()).filter(Boolean))]
      setMapping(aliases.map(names => guess(h,names))); setPipelineColumn(p)
      setSelected([distinct.find(v => /new leads?/i.test(v)) ?? '',distinct.find(v => /customer service/i.test(v)) ?? '']); setSingle(''); setData(parsed); setFilename(file.name)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to read export.') }
    finally { setBusy(false) }
  }
  return <main className="migration"><header><span className="migration-eyebrow">HUBSPOT → BIGIN</span><h1>Prepare your migration</h1><p>Upload a deal export, review the fields, and download clean pipeline files.</p></header>
    <section><h2>1. Upload your HubSpot export</h2><p>Export deals with all properties, including Pipeline, Deal owner, Phone Number and Paid date (all pipelines). Choose display labels for owners and stages when available.</p><label className="migration-upload">{busy ? 'Reading export…' : 'Choose CSV or TSV'}<input type="file" accept=".csv,.tsv" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = '' }} /></label><p className="migration-muted">Files are processed in this tab only. Refreshing clears the upload. Repeat purchases are kept.</p>{filename && <p>{filename} · {Math.max(0,data.length-1).toLocaleString()} rows</p>}{error && <p role="alert">{error}</p>}</section>
    {data.length > 0 && <><section><h2>2. Match pipelines and fields</h2><div className="migration-grid"><label>Pipeline column<select value={pipelineColumn} onChange={e => { setPipelineColumn(Number(e.target.value)); setSelected(['','']) }}><option value={-1}>No pipeline column — single pipeline export</option>{headers.map((h,i) => <option key={i} value={i}>{h}</option>)}</select></label>{pipelineColumn < 0 ? <label>This file belongs to<select value={single} onChange={e => setSingle(e.target.value)}><option value="">Select pipeline</option><option>New Leads</option><option>Customer Service</option></select></label> : ['New Leads','Customer Service'].map((name,i) => <label key={name}>{name} source value<select value={selected[i]} onChange={e => setSelected(selected.map((v,j) => i===j ? e.target.value : v))}><option value="">Do not include</option>{values.filter(v => v !== selected[1-i]).map(v => <option key={v}>{v}</option>)}</select></label>)}</div><p>Numeric pipeline or owner IDs cannot be resolved from a deal CSV alone. Select the pipeline ID above; map an owner-name column below, or replace IDs with names in your export.</p><div className="migration-grid">{columns.map((column,i) => i === 10 || i === 12 ? null : <label key={column}>{column}{[0,3].includes(i) ? ' *' : ''}<select value={mapping[i] ?? -1} onChange={e => setMapping(mapping.map((v,j) => j===i ? Number(e.target.value) : v))}><option value={-1}>Not provided</option>{headers.map((h,j) => <option key={j} value={j}>{h}</option>)}</select></label>)}</div>
    <label className="migration-check"><input type="checkbox" checked={placeholders} onChange={e => setPlaceholders(e.target.checked)} /> Use reference defaults: blank owner → Jeuz Vinci; blank close/paid dates → 2020-01-01.</label><p className="migration-muted">Recognized Sellers, CS and Nutri prefixes are kept in Bigin format (for example, Sellers - Jane Doe). NEW SALE is removed without guessing a team. Client names lose digits and dashes. Names without a recognized prefix remain unclassified; pipeline and owner alone do not establish the team. Phones keep digits; Email becomes phone@dummy.com. Product is WLI. Known stages use the reference Bigin labels. Dates must use YYYY-MM-DD (ISO timestamps also accepted); ambiguous dates go to review. Other values stay as exported.</p></section>
    <section><h2>3. Review and download</h2>{!ready ? <p role="status">Map Deal Name and Phone Number, then choose at least one pipeline.</p> : <><div className="migration-stats"><strong>{result.groups.flat().length.toLocaleString()} ready</strong><span>{result.review.length.toLocaleString()} need review</span><span>{result.outside.toLocaleString()} outside selected pipelines</span><span>{result.defaults.toLocaleString()} with missing owner or dates</span></div>{['New Leads','Customer Service'].map((name,i) => <div className="migration-export" key={name}><div><h3>{name}</h3><p>{result.groups[i].length.toLocaleString()} deals · {Math.ceil(result.groups[i].length/10000)} CSV files</p></div><div>{Array.from({length: Math.ceil(result.groups[i].length/10000)},(_,batch) => <button key={batch} onClick={() => download(`${name.toLowerCase().replaceAll(' ','-')}-${batch+1}.csv`, [columns,...result.groups[i].slice(batch*10000,(batch+1)*10000)])}>Download {batch+1}</button>)}</div></div>)}{result.review.length > 0 && <button onClick={() => download('migration-review.csv',[['Source row','Issues',...headers],...result.review])}>Download excluded rows for review</button>}<h3>Cleaned preview · first 20 deals</h3><div className="migration-table"><table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{result.groups.flat().slice(0,20).map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j}>{cell || '—'}</td>)}</tr>)}</tbody></table></div><p className="migration-muted">Downloads contain up to 10,000 deals each. Review owner names and stage labels before importing into the destination Bigin pipeline. This page prepares files; it does not create CRM records.</p></>}</section></>}
  </main>
}

