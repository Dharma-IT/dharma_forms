import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticate, publicAuthConfig } from './supabase.mjs'
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key'
process.env.SUPABASE_SECRET_KEY = 'private-test-key'
test('public auth config never includes server secret', () => {
  assert.deepEqual(publicAuthConfig(), { url: 'https://example.supabase.co', publishableKey: 'public-test-key' })
})
test('authentication rejects absent and malformed credentials', async () => {
  for (const value of [undefined, '', 'Basic abc', 'Bearer ' + 'x'.repeat(10001)]) assert.equal(await authenticate(value), null)
})
test('authentication verifies token with Auth and requires confirmed user', async () => {
  let seen
  const factory = user => () => ({ auth: { getUser: async token => { seen = token; return { data: { user }, error: null } } } })
  assert.equal(await authenticate('Bearer invalid', () => ({ auth: { getUser: async () => ({ error: new Error('Invalid token') }) } })), null)
  assert.equal(await authenticate('Bearer unconfirmed', factory({ id: '123' })), null)
  const user = { id: '123', email_confirmed_at: '2026-01-01' }
  assert.deepEqual(await authenticate('Bearer valid', factory(user)), user)
  assert.equal(seen, 'valid')
})
