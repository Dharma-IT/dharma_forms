import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { authenticatedFetch } from './auth'
import './Stage.css'

type Client = { id: string; name: string; email: string; phone: string }
type Summary = { id: string; name: string; pipeline: string; stage: string; paid: boolean; paidDate: string | null; createdTime: string | null; owner: { id: string; name: string }; amount: number }
type Product = { id: string; name: string; price: number }
type Line = Product & { quantity: number; total?: number; discount?: number; rowId?: string }
type Deal = Summary & { owner: { id: string; name: string }; contactId: string; version: string; stages: string[]; paymentNotes: string; paymentNotesMax: number; paymentMethod: string; paymentMethods: { value: string; label: string }[]; installments: number; totalPayable: number | null; productText: string; products: Line[] }
const createdDate = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value)) : 'Not available'
const dealCategory = (value: Summary) => /^sellers?\b/i.test(value.name) ? 'Sellers' : /^CS\b/i.test(value.name) ? 'Customer Service' : value.pipeline
const money = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const lineTotal = (price: number, quantity: number, discount: number) => Number.isFinite(price + quantity + discount) && price >= 0 && quantity > 0 && discount >= 0 && discount <= 100 ? Math.round((price * quantity * (1 - discount / 100) + Number.EPSILON) * 100) / 100 : null
async function api(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(`/api/stage/${path}`, init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not reach the CRM. Please retry.')
  return data
}

export default function Stage() {
  const [query, setQuery] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [searched, setSearched] = useState(false)
  const [more, setMore] = useState(false)
  const [client, setClient] = useState<Client | null>(null)
  const [deals, setDeals] = useState<Summary[]>([])
  const [deal, setDeal] = useState<Deal | null>(null)
  const [ownerTarget, setOwnerTarget] = useState<Deal | null>(null)
  const [ownerUsers, setOwnerUsers] = useState<{ id: string; name: string; email: string }[]>([])
  const [ownerId, setOwnerId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [draftPrice, setDraftPrice] = useState('0')
  const [draftQuantity, setDraftQuantity] = useState('1')
  const [draftDiscount, setDraftDiscount] = useState('0')
  const [added, setAdded] = useState<Line[]>([])
  const [stage, setStage] = useState('')
  const [notes, setNotes] = useState('')
  const [method, setMethod] = useState('')
  const [installments, setInstallments] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selection = useRef(0)
  const actionPanel = useRef<HTMLFormElement>(null)
  const activeAction = ownerTarget ? `owner:${ownerTarget.id}` : deal ? `edit:${deal.id}` : ''
  useEffect(() => {
    if (!activeAction) return
    const frame = requestAnimationFrame(() => {
      actionPanel.current?.focus({ preventScroll: true })
      actionPanel.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeAction])
  function chooseAnotherDeal() {
    selection.current++
    setDeal(null); setOwnerTarget(null); setAdded([]); setProductId(''); setError('')
  }
  useEffect(() => {
    const controller = new AbortController()
    api('products', { signal: controller.signal }).then(data => setProducts(data.products)).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [])
  function showDeal(value: Deal) {
    if (value.paid) { setDeal(null); setAdded([]); return }
    setDeal(value); setStage(value.stage); setNotes(value.paymentNotes); setMethod(value.paymentMethod); setInstallments(String(value.installments)); setAdded([]); setProductId(''); setProductQuery(''); setDraftPrice('0'); setDraftQuantity('1'); setDraftDiscount('0')
  }
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); selection.current++
    setOwnerTarget(null); setClient(null); setDeal(null); setDeals([]); setClients([]); setSearched(false)
    try { const data = await api(`search?${new URLSearchParams({ q: query.trim() })}`); setClients(data.clients); setMore(data.more); setSearched(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Search failed.') }
    finally { setBusy(false) }
  }
  async function selectClient(value: Client) {
    const serial = ++selection.current
    setBusy(true); setError(''); setNotice(''); setOwnerTarget(null); setDeal(null); setDeals([]); setClient(value)
    try { const data = await api(`clients/${value.id}`); if (selection.current === serial) { setClient(data.client); setDeals(data.deals) } }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load client deals.') }
    finally { setBusy(false) }
  }
  async function selectDeal(id: string) {
    const serial = ++selection.current
    setBusy(true); setError(''); setNotice(''); setOwnerTarget(null); setDeal(null)
    try { const data = await api(`deals/${id}`); if (selection.current === serial) { showDeal(data.deal); if (data.deal.paid) { setDeals(current => current.map(d => d.id === id ? { ...d, paid: true, stage: data.deal.stage, owner: data.deal.owner } : d)); setNotice('This deal is already paid and cannot be selected.') } } }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load deal.') }
    finally { setBusy(false) }
  }
  async function openOwnerChange(id: string) {
    setBusy(true); setError(''); setNotice(''); setDeal(null); setAdded([]); setProductId(''); setOwnerTarget(null)
    try {
      const [data, people] = await Promise.all([api(`deals/${id}`), api('users')])
      if (data.deal.paid) {
        setDeals(current => current.map(d => d.id === id ? { ...d, paid: true, stage: data.deal.stage, owner: data.deal.owner } : d))
        setNotice('This deal is already paid and its owner cannot be changed.')
        return
      }
      setOwnerUsers(people.users); setOwnerId(data.deal.owner.id); setOwnerTarget(data.deal)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load deal owners.') }
    finally { setBusy(false) }
  }
  async function saveOwner(event: FormEvent) {
    event.preventDefault()
    if (!ownerTarget || !client || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await api(`deals/${ownerTarget.id}/owner`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: client.id, version: ownerTarget.version, ownerId }) })
      setDeal(current => current && current.id === data.deal.id ? (data.deal.paid ? null : { ...current, version: data.deal.version, owner: data.deal.owner }) : current)
      setDeals(current => current.map(d => d.id === data.deal.id ? { ...d, paid: data.deal.paid, stage: data.deal.stage, owner: data.deal.owner } : d))
      setOwnerTarget(null); setNotice(`Deal owner changed to ${data.deal.owner.name || ownerUsers.find(u => u.id === ownerId)?.name || 'the selected user'}.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change the deal owner.') }
    finally { setBusy(false) }
  }
  function addProduct() {
    const product = products.find(p => p.id === productId)
    if (!product || added.some(p => p.id === product.id) || deal?.products.some(p => p.id === product.id)) return
    if (!/^\d+(?:\.\d{1,2})?$/.test(draftPrice) || !/^\d+(?:\.\d{1,2})?$/.test(draftQuantity) || !/^\d+(?:\.\d{1,2})?$/.test(draftDiscount) || lineTotal(Number(draftPrice), Number(draftQuantity), Number(draftDiscount)) === null || Number(draftQuantity) > 10000 || Number(draftPrice) > 999999999) { setError('Enter a valid list price, positive quantity, and a discount between 0 and 100 percent.'); return }
    setAdded(current => [...current, { ...product, price: Number(draftPrice), quantity: Number(draftQuantity), discount: Number(draftDiscount) }]); setProductId(''); setDraftPrice('0'); setDraftQuantity('1'); setDraftDiscount('0'); setError('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!deal || !client || busy) return
    if (productId) { setError('Click Add to selection for the selected product before saving, or clear the product selection.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await api(`deals/${deal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: client.id, version: deal.version, stage, paymentNotes: notes, paymentMethod: method, installments, addProducts: added.map(p => ({ id: p.id, price: p.price, quantity: p.quantity, discount: p.discount ?? 0 })) }) })
      showDeal(data.deal); setDeals(current => current.map(d => d.id === deal.id ? { ...d, stage: data.deal.stage, paid: data.deal.paid, paidDate: data.deal.paidDate, amount: data.deal.amount } : d)); setNotice(data.deal.paid ? 'Saved to Bigin. This deal is now paid and can no longer be selected.' : 'Saved to Bigin. Products, Other Info, and payment details are up to date.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save. Reload the deal before retrying.') }
    finally { setBusy(false) }
  }
  return <main className={`stage-page${busy ? ' stage-is-busy' : ''}`} aria-busy={busy}>
    <header className="stage-header"><div className="stage-header-content"><span className="stage-eyebrow"><span className="stage-live-dot" /> CLIENT WORKSPACE</span><h1>Every detail.<br /><em>Moving forward.</em></h1><p>Manage stages, payments, and the people behind every deal.</p><div className="stage-header-tags"><span>Stages &amp; payments</span><span>Connected to Bigin</span></div></div><div className="stage-header-art" aria-hidden="true"><div className="stage-orbit stage-orbit-one" /><div className="stage-orbit stage-orbit-two" /><div className="stage-art-core"><svg viewBox="0 0 64 64" fill="none"><path d="M14 44 28 30l10 8 13-19M39 19h12v12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></div><span className="stage-art-chip stage-art-chip-top">A little more momentum</span><span className="stage-art-chip stage-art-chip-bottom">One workspace. Every deal.</span></div></header>
    <nav className="stage-progress" aria-label="Workspace progress"><span className="stage-step is-active"><b>01</b> Find a client</span><span className={`stage-step${client ? ' is-active' : ''}`}><b>02</b> Choose a deal</span><span className={`stage-step${activeAction ? ' is-active' : ''}`}><b>03</b> Make your move</span></nav>
    {error && <p className="stage-error" role="alert">{error}</p>}
    {notice && <p className="stage-notice" role="status">{notice}</p>}
    <form className="stage-search" onSubmit={search}><label>Find a client<input type="search" required minLength={2} maxLength={120} value={query} onChange={e => setQuery(e.target.value)} placeholder="Email, name, or phone number" /></label><button className="stage-primary" disabled={busy}>{busy ? 'Please wait…' : 'Search clients'}</button></form>
    <div className="stage-columns"><aside className="stage-card stage-client-list"><div className="stage-section-heading"><h2>Clients</h2><span className="stage-count">{clients.length} results</span></div>
      {!searched && <p>Search to get started.</p>}
      {searched && !clients.length && <p>No matching clients. Try another email, name, or phone number.</p>}
      {more && <p>More matches are available. Refine your search to find the right client.</p>}
      <ul className="stage-results">{clients.map(c => <li key={c.id}><button disabled={busy} aria-pressed={client?.id === c.id} onClick={() => selectClient(c)}><strong>{c.name}</strong><span>{c.email || 'No email'}</span><span>{c.phone || 'No phone'}</span></button></li>)}</ul>
    </aside><section className="stage-workspace">
      {client && <section className="stage-card"><h2>{client.name}</h2><p>{client.email} {client.phone && <> · {client.phone}</>}</p>{activeAction ? <div className="stage-collapsed-selection"><div><span className="stage-eyebrow">{ownerTarget ? 'CHANGING DEAL OWNER' : 'EDITING DEAL'}</span><strong>{(ownerTarget || deal)?.name}</strong><span>{(ownerTarget || deal)?.stage}</span></div><button type="button" disabled={busy} onClick={chooseAnotherDeal}>Choose another deal <span aria-hidden="true">&#8595;</span></button></div> : <h3>Select a deal</h3>}
        {!activeAction && <>
        {!busy && !deals.length && <p>No New Leads or Customer Service deals are linked to this client. Create or link their deal in Bigin first.</p>}
        <div className="stage-deals">{deals.map(d => <article className={`stage-deal-option${d.paid ? ' is-paid' : ''}${deal?.id === d.id ? ' is-selected' : ''}`} key={d.id}>
          <button disabled={busy || d.paid} className={`stage-deal-select${d.paid ? ' stage-paid-deal' : ''}`} aria-pressed={deal?.id === d.id} onClick={() => selectDeal(d.id)}>
            <span className="stage-deal-topline"><span className={`stage-category${dealCategory(d) === 'Sellers' ? ' stage-category-sales' : ''}`}>{dealCategory(d)}</span><span className={`stage-status${d.paid ? ' status-paid' : d.stage?.toUpperCase() === 'LOST' ? ' status-lost' : ''}`}>{d.stage}</span></span>
            <strong className="stage-deal-title">{d.name}</strong><span className="stage-deal-pipeline">{d.pipeline}</span>
            <span className="stage-deal-value"><span className="stage-meta-label">DEAL VALUE</span><span>{d.amount == null ? 'Not set' : money(d.amount)}</span></span>
            <span className="stage-deal-owner"><span className="stage-owner-avatar" aria-hidden="true">{d.owner?.name?.slice(0, 1) || '-'}</span><span><span className="stage-meta-label">DEAL OWNER</span><span>{d.owner?.name || 'Not available'}</span></span></span>
            <span className="stage-created"><span className="stage-meta-label">CREATED &middot; EASTERN TIME</span><time dateTime={d.createdTime || undefined}>{createdDate(d.createdTime)}</time></span>
            {d.paid && <span className="stage-paid-caption">Paid{d.paidDate ? ` on ${d.paidDate}` : ''} &middot; Locked</span>}
          </button><button className="stage-change-owner" type="button" disabled={busy || d.paid} onClick={() => openOwnerChange(d.id)}>Change Deal Owner <span aria-hidden="true">&#8599;</span></button>
        </article>)}</div></>}
      </section>}
      {ownerTarget && <form ref={actionPanel} tabIndex={-1} aria-label="Change Deal Owner" className="stage-card stage-action-panel" onSubmit={saveOwner}><h2>Change Deal Owner</h2><p>{ownerTarget.name}</p><p>Current owner: {ownerTarget.owner.name || 'Unavailable'}</p><label>New deal owner<select required disabled={busy} value={ownerId} onChange={e => setOwnerId(e.target.value)}><option value="">Select a Bigin user</option>{ownerUsers.map(user => <option key={user.id} value={user.id}>{user.name}{user.email ? ` (${user.email})` : ''}</option>)}</select></label><div className="stage-owner-actions"><button className="stage-primary" disabled={busy || !ownerId || ownerId === ownerTarget.owner.id}>Save owner</button><button type="button" disabled={busy} onClick={chooseAnotherDeal}>Cancel</button></div></form>}
      {!client && <section className="stage-card stage-empty"><div className="stage-empty-icon" aria-hidden="true">&#8599;</div><span className="stage-eyebrow">READY WHEN YOU ARE</span><h2>Select a client</h2><p>Their linked deals and product details will appear here.</p></section>}
      {deal && <form ref={actionPanel} tabIndex={-1} aria-label="Edit deal stage and payment details" className="stage-card stage-editor stage-action-panel" onSubmit={save}><fieldset disabled={busy}><div className="stage-deal-heading"><div><span className="stage-eyebrow">{deal.pipeline}</span><h2>{deal.name}</h2></div><button type="button" onClick={() => selectDeal(deal.id)}>Reload deal</button></div>
        <p className="stage-editor-intro">Update the stage, then review the products and payment details below.</p>
        <label className="stage-stage-field">Deal Stage<select aria-label="Stage" required value={stage} onChange={e => setStage(e.target.value)}>{deal.stages.map(value => <option key={value}>{value}</option>)}</select></label>
        <section className="stage-dependent-fields" aria-label="Products and payment details">
        <h3>Products on this deal</h3>
        {!deal.products.length ? <p>No associated products yet.</p> : <div className="stage-table-wrap"><table><thead><tr><th>Product</th><th>List price</th><th>Quantity</th><th>Discount (%)</th><th>Total</th></tr></thead><tbody>{deal.products.map((p, i) => <tr key={p.rowId || `${p.id}:${i}`}><td>{p.name}</td><td>{money(p.price)}</td><td>{p.quantity}</td><td>{p.discount}</td><td>{money(p.total ?? 0)}</td></tr>)}</tbody></table></div>}
        <div className="stage-product-picker"><label>Find a CRM product<input type="search" value={productQuery} onChange={e => setProductQuery(e.target.value)} placeholder="Filter the product dropdown" /></label><label>Add product<select aria-label="Add product" value={productId} onChange={e => { setProductId(e.target.value); setDraftPrice(String(products.find(p => p.id === e.target.value)?.price ?? 0)); setDraftQuantity('1'); setDraftDiscount('0') }}><option value="">Select a CRM product</option>{products.filter(p => p.name.toLowerCase().includes(productQuery.toLowerCase())).map(p => <option key={p.id} value={p.id} disabled={deal.products.some(row => row.id === p.id) || added.some(row => row.id === p.id)}>{p.name}</option>)}</select></label>
          <fieldset className="stage-product-fields" disabled={!productId}>
            <label>List price ($)<input type="number" required min="0" max="999999999" step="0.01" value={draftPrice} onChange={e => setDraftPrice(e.target.value)} /></label>
            <label>Quantity<input type="number" required min="0.01" max="10000" step="0.01" value={draftQuantity} onChange={e => setDraftQuantity(e.target.value)} /></label>
            <label>Discount (%)<input type="number" required min="0" max="100" step="0.01" value={draftDiscount} onChange={e => setDraftDiscount(e.target.value)} /></label>
            <label>Line total<input readOnly value={money(lineTotal(Number(draftPrice), Number(draftQuantity), Number(draftDiscount)))} /></label>
          </fieldset>
          <button type="button" disabled={!productId} onClick={addProduct}>Add to selection</button></div>
        {added.map(p => <div className="stage-added-product" key={p.id}><strong>{p.name}</strong><div className="stage-product-fields">
          <label>List price ($)<input aria-label={`List price for ${p.name}`} type="number" required min="0" max="999999999" step="0.01" value={p.price} onChange={e => setAdded(current => current.map(row => row.id === p.id ? { ...row, price: Number(e.target.value) } : row))} /></label>
          <label>Quantity<input aria-label={`Quantity for ${p.name}`} type="number" required min="0.01" max="10000" step="0.01" value={p.quantity} onChange={e => setAdded(current => current.map(row => row.id === p.id ? { ...row, quantity: Number(e.target.value) } : row))} /></label>
          <label>Discount (%)<input aria-label={`Discount for ${p.name}`} type="number" required min="0" max="100" step="0.01" value={p.discount ?? 0} onChange={e => setAdded(current => current.map(row => row.id === p.id ? { ...row, discount: Number(e.target.value) } : row))} /></label>
          <label>Line total<input aria-label={`Line total for ${p.name}`} readOnly value={money(lineTotal(p.price, p.quantity, p.discount ?? 0))} /></label>
        </div><button type="button" onClick={() => setAdded(current => current.filter(row => row.id !== p.id))}>Remove selection</button></div>)}
        <p className="stage-help">New products are added when you save. Existing product prices, quantities, and discounts stay in place.</p>
        <label>Product · Other Info<textarea readOnly rows={2} value={deal.productText} /></label><p className="stage-help">Product names are synchronized here as a comma-separated list when products are added.</p>
        <label>Payment notes<textarea maxLength={deal.paymentNotesMax} rows={4} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <div className="stage-field-grid"><label>Payment method<select aria-label="Payment method" value={method} onChange={e => setMethod(e.target.value)}><option value="">No payment method</option>{method && !deal.paymentMethods.some(v => v.value === method) && <option value={method}>{method}</option>}{deal.paymentMethods.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</select></label><label>Installments ($)<input required type="number" min="0" max="999999999" step="0.01" value={installments} onChange={e => setInstallments(e.target.value)} /></label></div>
        <div className="stage-totals"><label>Amount<input readOnly value={money(deal.amount)} /></label><label>Total Amount Payable<input readOnly value={money(deal.totalPayable)} /></label></div><p className="stage-help">Total Amount Payable is calculated by Bigin and refreshes after saving.</p>
        </section>
        <footer className="stage-editor-actions"><button className="stage-primary stage-save" type="submit">{busy ? 'Saving to Bigin…' : 'Save changes'}</button><button type="button" onClick={() => { chooseAnotherDeal(); setNotice('Unsaved changes cancelled.') }}>Cancel</button></footer>
      </fieldset></form>}
    </section></div>
  </main>
}
