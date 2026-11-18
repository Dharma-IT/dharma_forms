import schema from './migration-schema.json' with { type: 'json' }
export const columns = ['Deal Name', 'Meeting type', 'Evaluation date and hour', 'Phone Number', 'Agent Lead Management', 'Lead Cassification', 'Stage', 'Closing Date', 'Deal Owner', 'Amount', 'Email', 'Paid Date', 'Product', 'Contact Name', 'Tag', 'Channel', 'Source', 'Payment Notes', 'Payment Method', 'Installments', 'Pipeline', 'Sub Pipeline', 'HubSpot Deal ID']
export const aliases = [ ['dealname','deal name'], ['meeting_type','meeting type'], ['evaluation_date_and_hour_2','evaluation date and hour'], ['phone','phone number','mobile phone number','mobilephone'], ['agent_lead_management','agent lead management'], ['classification','lead classification'], ['dealstage','deal stage'], ['closedate','close date'], ['hubspot_owner_id','deal owner','deal ownership'], ['amount'], ['email'], ['paid_date_all_pipelines','paid date (all pipelines)','paid date'], ['product'] ]
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
export function canonicalPerson(value: string) {
  if (['mariasandoval', 'anasandoval'].includes(normalize(value))) return 'Ana Sandoval'
  return ['alinestrelow', 'alicestrelow', 'alicef'].includes(normalize(value)) ? 'Alice Strelow' : value.trim()
}
export function guess(headers: string[], names: string[]) { return headers.findIndex(header => names.some(name => normalize(header) === normalize(name))) }
export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '')
  const first = text.split(/\r?\n/, 1)[0]
  const delimiter = [',', ';', '\t'].sort((a,b) => first.split(b).length - first.split(a).length)[0]
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i+1] === '"') { cell += '"'; i++ }
      else if (quoted || !cell) quoted = !quoted
      else throw new Error('Invalid quote in CSV. Export the file as CSV again.')
    } else if (c === delimiter && !quoted) { row.push(cell); cell = '' }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i+1] === '\n') i++
      row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.')
  row.push(cell); if (row.some(value => value.trim())) rows.push(row)
  if (!rows.length || !rows[0].some(Boolean)) throw new Error('This file is empty.')
  if (rows.slice(1).some(row => row.length !== rows[0].length)) throw new Error('Some rows have a different number of columns. Check the CSV export.')
  return rows
}
const stages: Record<string,string> = { 'NEW LEAD':'New Leads','NEW LEADS':'New Leads','NEW CLIENT':'New Leads','PROBLEM':'LOST','PAID':'PAID','LOST':'LOST','EVALUATION SCHEDULED':'Evaluation Scheduled','FUTURE CONTACT':'Future Contact','WAITING FOR PAYMENT':'Waiting for Payment','WAITING FOT PAYMENT':'Waiting for Payment','REFUND':'Refund','DISPUTE WON':'Dispute Won','MEDICALLY APPROVED (WON)':'Closed Won','CLOSED WON':'Closed Won' }
aliases[5].push('Lead Cassification')
aliases[6].push('Stage')
aliases[7].push('Closing Date')
aliases.push(['contact name'], ['tag', 'tags'], ['channel', 'chanel'], ['source', 'lead source'], ['payment notes', 'payment_notes'], ['payment method', 'payment_method'], ['installments','installment fee','installment_fee'], [], [])
export function cleanRow(source: string[], mapping: number[], placeholders: boolean, pipeline?: string) {
  const row = columns.map((_, i) => (source[mapping[i]] ?? '').trim())
  const originalName = row[0]
  const prefix = row[0].match(/^\s*(new\s+sale|sellers?|cs|customer\s+service|nutri|nutritionists?)\s*[-–—:]\s*/i)
  const team = prefix ? (/^(sell|new\s+sale)/i.test(prefix[1]) ? 'Sellers' : /^(cs|customer)/i.test(prefix[1]) ? 'CS' : 'Nutri') : ''
  const clientName = row[0].replace(/^\s*(?:new\s+sale|sellers?|cs|customer\s+service|nutri|nutritionists?)\s*[-–—:]\s*/i,'').replace(/[\d\-–—]/g,' ').replace(/\s+/g,' ').trim()
  row[0] = clientName ? (team ? `${team} - ${clientName}` : clientName) : ''
  row[3] = row[3].replace(/\D/g,'')
  if (!row[0]) {
    const nameNumber = (originalName.match(/\+?\d[\d ()]*\d/g) ?? []).map(value => value.replace(/\D/g, '')).filter(value => value.length >= 7 && value.length <= 15).sort((a, b) => b.length - a.length)[0]
    const number = row[3] || nameNumber
    if (number) row[0] = `Client - ${number}`
  }
  row[6] = stages[row[6].toUpperCase()] ?? row[6]
  if (!row[15] || ['aircall', 'doxy', 'whatsapp'].includes(row[15].toLowerCase())) row[15] = 'Call'
  const issues: string[] = []
  for (const index of [7,11]) {
    if (!row[index]) { if (placeholders) row[index] = '2020-01-01' }
    else {
      const match = row[index].match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/)
      const date = match ? `${match[1]}-${match[2]}-${match[3]}` : ''
      if (date && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date) row[index] = date
      else issues.push(`Unrecognized ${columns[index]}: ${row[index]} (use YYYY-MM-DD)`)
    }
  }
  if (!row[8]) row[8] = 'ca@dharmanutritionclinic.com'
  else if (/^\d+$/.test(row[8])) issues.push('HubSpot owner ID needs mapping to a Bigin owner name or email')
  row[10] = row[3] ? `${row[3]}@dummy.com` : ''
  row[12] ||= 'WLI'
  row[13] ||= clientName
  const layout = schema.find(item => item.name === pipeline)
  if (row[4] && ['Alice Strelow', 'Ana Sandoval'].includes(canonicalPerson(row[4]))) {
    row[4] = layout?.fields.find(f => f.api === 'Agent_Lead_Management')?.options.find(value => canonicalPerson(value) === canonicalPerson(row[4])) ?? row[4]
  }
  if (layout) {
    row[20] = layout.name
    row[21] = layout.subPipeline
    if (!layout.stages.includes(row[6])) issues.push(`Stage is not available in ${pipeline}: ${row[6] || '(blank)'}`)
    for (const index of [4,15,16,18]) {
      const field = layout.fields.find(f => f.label === columns[index])
      if (row[index] && field?.options.length) {
        const match = field.options.find(value => value.toLowerCase() === row[index].toLowerCase())
        if (match) row[index] = match
        else if (index === 16) row[index] = ''
        else issues.push(`${columns[index]} is not an available Bigin option: ${row[index]}`)
      }
    }
  }
  if (row[19] && !/^-?\d+(?:\.\d+)?$/.test(row[19])) issues.push('Installments must be a currency amount')
  if (row[9] && !/^-?\d+(?:\.\d+)?$/.test(row[9])) issues.push('Amount must be a number without currency symbols or separators')
  if (row[2] && (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(row[2]) || Number.isNaN(Date.parse(row[2])))) issues.push('Evaluation date and hour must be an ISO date/time')
  if (!row[0]) issues.push('Missing usable deal name')
  if (!row[3]) issues.push('Missing phone')
  return { row, issues }
}
export function csv(rows: string[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => `"${(/^[\s]*[=+@-]/.test(value) ? "'" : '') + value.replace(/"/g,'""')}"`).join(',')).join('\r\n')
}






// Import is started inside the selected Bigin pipeline; routing columns stay in audit files.
export const dealColumns = columns.filter((_, index) => index !== 20 && index !== 21)
export function dealExportRow(row: string[]) { return row.filter((_, index) => index !== 20 && index !== 21) }
