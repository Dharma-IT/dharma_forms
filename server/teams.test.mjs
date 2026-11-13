import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMember, getBiginUsers } from './teams.mjs'
const users = [{ id: '123', name: 'Verified User', email: 'user@example.com' }]
test('members use identity from Bigin, never client-supplied names', () => {
  assert.deepEqual(validateMember({ team: 'sellers', id: '123', name: 'Imposter', bookingUrl: 'https://calendar.example/book' }, users), { team: 'sellers', id: '123', name: 'Verified User', bookingUrl: 'https://calendar.example/book' })
})
test('unknown Bigin accounts and invalid teams cannot be added', () => {
  assert.throws(() => validateMember({ team: 'sellers', id: '999', bookingUrl: '' }, users), /not found/)
  assert.throws(() => validateMember({ team: 'admin', id: '123', bookingUrl: '' }, users), /valid team/)
})
test('calendar links require HTTPS, no credentials, and a link for hosts', () => {
  for (const bookingUrl of ['', 'javascript:alert(1)', 'http://example.com', 'https://user:password@example.com']) assert.throws(() => validateMember({ team: 'sellers', id: '123', bookingUrl }, users))
  assert.equal(validateMember({ team: 'agents', id: '123', bookingUrl: '' }, users).bookingUrl, '')
})
test('Bigin users paginate and expose only needed fields', async () => {
  const paths = []
  const rows = await getBiginUsers(async path => {
    paths.push(path)
    return { users: [{ id: String(paths.length), full_name: 'User', email: 'user@example.com', secret: 'hidden' }], info: { more_records: paths.length === 1 } }
  })
  assert.equal(paths.length, 2)
  assert.match(paths[1], /page=2/)
  assert.equal(rows.length, 2)
  assert.equal('secret' in rows[0], false)
})
