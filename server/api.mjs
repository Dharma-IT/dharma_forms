import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createSubmission, getFormMetadata } from './submissions.mjs'
import { timingSafeEqual, createHash as hash } from 'node:crypto'
import { getMembers, getBiginUsers, changeMember } from './teams.mjs'

const directory = new URL('../.bigin-submissions/', import.meta.url)
await mkdir(directory, { recursive: true })
// Exact frontend origins only; include the production Vercel URL in Render.
const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:3001',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
])
const pending = new Set()
let failedPins = 0
let pinWindow = Date.now()
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
  try {
    if (req.method === 'GET' && req.url === '/api/teams') {
      const members = await getMembers()
      return reply(200, { members })
    }
    if (req.url?.startsWith('/api/manage-team')) {
      const managementPin = process.env.MANAGE_TEAM_PIN
      if (!managementPin || !/^\d{4,12}$/.test(managementPin)) return reply(503, { error: 'Team management is unavailable. Configure MANAGE_TEAM_PIN on the server.' })
      if (Date.now() - pinWindow > 60000) { failedPins = 0; pinWindow = Date.now() }
      if (failedPins >= 10) return reply(429, { error: 'Too many PIN attempts. Try again in a minute.' })
      const provided = hash('sha256').update(String(req.headers['x-management-pin'] || '')).digest()
      const expected = hash('sha256').update(managementPin).digest()
      if (!timingSafeEqual(provided, expected)) { failedPins++; return reply(401, { error: 'Incorrect PIN.' }) }
      if (req.method === 'GET' && req.url === '/api/manage-team') return reply(200, { members: await getMembers() })
      if (req.method === 'GET' && req.url === '/api/manage-team/users') return reply(200, { users: await getBiginUsers() })
      if (['PUT', 'DELETE'].includes(req.method) && req.url === '/api/manage-team') {
        if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return reply(403, { error: 'Origin not allowed' })
        if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'JSON required' })
        let raw = ''
        for await (const chunk of req) { raw += chunk; if (raw.length > 8000) return reply(413, { error: 'Request too large' }) }
        return reply(200, { members: await changeMember(JSON.parse(raw), req.method === 'DELETE') })
      }
      return reply(404, { error: 'Not found' })
    }
    if (req.method === 'GET' && req.url === '/api/bigin/options') {
      const metadata = await getFormMetadata()
      return reply(200, { pipelines: metadata.pipelines.map(({ id, name, subPipelines, stages, fields }) => ({ id, name, subPipelines, stages, channels: fields.find(f => f.api_name === 'Channel')?.pick_list_values?.map(v => v.actual_value).filter(v => v !== '-None-') || [], sources: fields.find(f => f.api_name === 'Lead_Source' || f.field_label === 'Source')?.pick_list_values?.map(v => v.actual_value).filter(v => v !== '-None-') || [] })) })
    }
    if (req.method !== 'POST' || req.url !== '/api/bigin/submissions') return reply(404, {error:'Not found'})
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return reply(403,{error:'Origin not allowed'})
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(415,{error:'JSON required'})
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/.test(key)) return reply(400,{error:'A valid submission key is required'})
    if (pending.has(key)) return reply(409,{error:'This submission is already processing. Please wait.'})
    let raw = ''
    for await (const chunk of req) { raw += chunk; if (raw.length > 16000) return reply(413,{error:'Request too large'}) }
    const details = JSON.parse(raw)
    const members = await getMembers()
    if (!members.some(member => member.team === 'agents' && member.id === details.agent) || !members.some(member => member.team === details.team && member.id === details.host)) return reply(400, { error: 'Select a current team member and booking agent. Refresh the form.' })
    const fingerprint = createHash('sha256').update(JSON.stringify(details)).digest('hex')
    const file = new URL(`${key}.json`, directory)
    pending.add(key)
    try {
      let progress
      try { progress = JSON.parse(await readFile(file,'utf8')) } catch(error) { if(error.code !== 'ENOENT') throw error; progress = {fingerprint} }
      if(progress.fingerprint !== fingerprint) return reply(409,{error:'This submission key belongs to different details. Refresh before starting another booking.'})
      if(progress.dealId) return reply(200,{contactId:progress.contactId,dealId:progress.dealId,contactReused:progress.contactReused})
      if(progress.dealAttempted) return reply(409,{error:'A previous deal save may have completed. Check Bigin before starting another submission.'})
      const save = value => writeFile(file,JSON.stringify(value),{mode:0o600})
      const result = await createSubmission(details,progress,undefined,undefined,save)
      reply(200,result)
    } finally { pending.delete(key) }
  } catch(error) { reply(400,{error: error instanceof SyntaxError ? 'Invalid JSON request' : error.message}) }
})
const port = Number(process.env.PORT || 3001)
server.listen(port, '0.0.0.0', () => {
  console.log(`Bigin API listening on port ${port}`)
})
