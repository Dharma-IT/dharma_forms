import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createSubmission, getFormMetadata } from './submissions.mjs'

const directory = new URL('../.bigin-submissions/', import.meta.url)
await mkdir(directory, { recursive: true })
const pending = new Set()
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
  try {
    if (req.method === 'GET' && req.url === '/api/bigin/options') {
      const metadata = await getFormMetadata()
      return reply(200, { pipelines: metadata.pipelines.map(({ id, name, subPipelines, stages, fields }) => ({ id, name, subPipelines, stages, channels: fields.find(f => f.api_name === 'Channel')?.pick_list_values?.map(v => v.actual_value).filter(v => v !== '-None-') || [], sources: fields.find(f => f.api_name === 'Lead_Source' || f.field_label === 'Source')?.pick_list_values?.map(v => v.actual_value).filter(v => v !== '-None-') || [] })) })
    }
    if (req.method !== 'POST' || req.url !== '/api/bigin/submissions') return reply(404, {error:'Not found'})
    if (req.headers.origin && !['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3001'].includes(req.headers.origin)) return reply(403,{error:'Origin not allowed'})
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(415,{error:'JSON required'})
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/.test(key)) return reply(400,{error:'A valid submission key is required'})
    if (pending.has(key)) return reply(409,{error:'This submission is already processing. Please wait.'})
    let raw = ''
    for await (const chunk of req) { raw += chunk; if (raw.length > 16000) return reply(413,{error:'Request too large'}) }
    const details = JSON.parse(raw)
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
