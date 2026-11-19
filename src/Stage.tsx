import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { authenticatedFetch } from './auth'
import './Stage.css'

type Client = { id: string; name: string; email: string; phone: string }
type Summary = { id: string; name: string; pipeline: string; stage: string; amount: number }
type Product = { id: string; name: string; price: number }
type Line = Product & { quantity: number; total?: number; discount?: number; rowId?: string }
type Deal = Summary & { contactId: string; version: string; stages: string[]; paymentNotes: string; paymentNotesMax: number; paymentMethod: string; paymentMethods: { value: string; label: string }[]; installments: number; totalPayable: number | null; productText: string; products: Line[] }
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
  useEffect(() => {
    const controller = new AbortController()
    api('products', { signal: controller.signal }).then(data => setProducts(data.products)).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [])
  function showDeal(value: Deal) {
    setDeal(value); setStage(value.stage); setNotes(value.paymentNotes); setMethod(value.paymentMethod); setInstallments(String(value.installments)); setAdded([]); setProductId(''); setProductQuery(''); setDraftPrice('0'); setDraftQuantity('1'); setDraftDiscount('0')
  }
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); selection.current++
    setClient(null); setDeal(null); setDeals([]); setClients([]); setSearched(false)
    try { const data = await api(`search?${new URLSearchParams({ q: query.trim() })}`); setClients(data.clients); setMore(data.more); setSearched(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Search failed.') }
    finally { setBusy(false) }
  }
  async function selectClient(value: Client) {
    const serial = ++selection.current
    setBusy(true); setError(''); setNotice(''); setDeal(null); setDeals([]); setClient(value)
    try { const data = await api(`clients/${value.id}`); if (selection.current === serial) { setClient(data.client); setDeals(data.deals) } }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load client deals.') }
    finally { setBusy(false) }
  }
  async function selectDeal(id: string) {
    const serial = ++selection.current
    setBusy(true); setError(''); setNotice(''); setDeal(null)
    try { const data = await api(`deals/${id}`); if (selection.current === serial) showDeal(data.deal) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load deal.') }
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
      showDeal(data.deal); setDeals(current => current.map(d => d.id === deal.id ? { ...d, stage: data.deal.stage, amount: data.deal.amount } : d)); setNotice('Saved to Bigin. Products, Other Info, and payment details are up to date.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save. Reload the deal before retrying.') }
    finally { setBusy(false) }
  }
  return <main className="stage-page">
    <header className="stage-header"><div><span className="stage-eyebrow">CLIENT WORKSPACE</span><h1>Stages & payments</h1><p>Find a client, select their deal, and update its stage, products, and payment details.</p></div></header>
    {error && <p className="stage-error" role="alert">{error}</p>}
    {notice && <p className="stage-notice" role="status">{notice}</p>}
    <form className="stage-search" onSubmit={search}><label>Find a client<input type="search" required minLength={2} maxLength={120} value={query} onChange={e => setQuery(e.target.value)} placeholder="Email, name, or phone number" /></label><button className="stage-primary" disabled={busy}>{busy ? 'Please wait…' : 'Search clients'}</button></form>
    <div className="stage-columns"><aside className="stage-card"><h2>Clients</h2>
      {!searched && <p>Search to get started.</p>}
      {searched && !clients.length && <p>No matching clients. Try another email, name, or phone number.</p>}
      {more && <p>More matches are available. Refine your search to find the right client.</p>}
      <ul className="stage-results">{clients.map(c => <li key={c.id}><button disabled={busy} aria-pressed={client?.id === c.id} onClick={() => selectClient(c)}><strong>{c.name}</strong><span>{c.email || 'No email'}</span><span>{c.phone || 'No phone'}</span></button></li>)}</ul>
    </aside><section className="stage-workspace">
      {client && <section className="stage-card"><h2>{client.name}</h2><p>{client.email} {client.phone && <> · {client.phone}</>}</p><h3>Select a deal</h3>
        {!busy && !deals.length && <p>No New Leads or Customer Service deals are linked to this client. Create or link their deal in Bigin first.</p>}
        <div className="stage-deals">{deals.map(d => <button disabled={busy} key={d.id} aria-pressed={deal?.id === d.id} onClick={() => selectDeal(d.id)}><strong>{d.name}</strong><span>{d.pipeline} · {d.stage}</span><span>{money(d.amount)}</span></button>)}</div>
      </section>}
      {!client && <section className="stage-card stage-empty"><h2>Select a client</h2><p>Their linked deals and product details will appear here.</p></section>}
      {deal && <form className="stage-card stage-editor" onSubmit={save}><fieldset disabled={busy}><div className="stage-deal-heading"><div><span className="stage-eyebrow">{deal.pipeline}</span><h2>{deal.name}</h2></div><button type="button" onClick={() => selectDeal(deal.id)}>Reload deal</button></div>
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
        <footer className="stage-editor-actions"><button className="stage-primary stage-save" type="submit">{busy ? 'Saving to Bigin…' : 'Save changes'}</button><button type="button" onClick={() => { showDeal(deal); setError(''); setNotice('Unsaved changes cancelled.') }}>Cancel</button></footer>
      </fieldset></form>}
    </section></div>
  </main>
}
