import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const envFile = fileURLToPath(new URL('../.env', import.meta.url))
const regions = ['com', 'eu', 'com.au', 'in', 'com.cn', 'jp', 'sa']
const accountsHosts = regions.map(region => `accounts.zoho.${region}`).concat('accounts.zohocloud.ca')
const apiHosts = regions.map(region => `www.zohoapis.${region}`).concat('www.zohoapis.ca')
let cachedToken
let refreshInFlight

export function validateDomain(value, allowed) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid Zoho domain. Use the HTTPS origin for your Zoho data center.')
  }
  return url.origin
}

async function tokenRequest(parameters) {
  const origin = validateDomain(process.env.BIGIN_ACCOUNTS_URL || 'https://accounts.zoho.com', accountsHosts)
  for (const key of ['BIGIN_CLIENT_ID', 'BIGIN_CLIENT_SECRET']) {
    if (!process.env[key]) throw new Error(`Missing ${key} in .env`)
  }
  const response = await fetch(`${origin}/oauth/v2/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: process.env.BIGIN_CLIENT_ID, client_secret: process.env.BIGIN_CLIENT_SECRET, ...parameters }),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  })
  const data = await response.json()
  if (!response.ok || data.error || !data.access_token) {
    const reason = ['invalid_code', 'invalid_client', 'invalid_scope', 'access_denied'].includes(data.error) ? data.error : `HTTP ${response.status}`
    throw new Error(`Zoho token request failed (${reason}). Check the code, credentials, scopes, and data center.`)
  }
  const apiDomain = validateDomain(data.api_domain, apiHosts)
  cachedToken = { accessToken: data.access_token, apiDomain, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 }
  return data
}

export async function exchangeCode(code) {
  if (!code.trim()) throw new Error('Authorization code is required.')
  const data = await tokenRequest({ grant_type: 'authorization_code', code: code.trim() })
  if (!data.refresh_token) throw new Error('Zoho did not return a refresh token. Generate a new Self Client code.')
  let contents = await readFile(envFile, 'utf8')
  for (const [key, value] of Object.entries({ BIGIN_REFRESH_TOKEN: data.refresh_token, BIGIN_API_DOMAIN: cachedToken.apiDomain })) {
    if (!/^[A-Za-z0-9.:/_-]+$/.test(value)) throw new Error('Unexpected token response format.')
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    contents = pattern.test(contents) ? contents.replace(pattern, `${key}=${value}`) : `${contents.trimEnd()}\n${key}=${value}\n`
    process.env[key] = value
  }
  await writeFile(envFile, contents, { mode: 0o600 })
}

export async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken
  if (!process.env.BIGIN_REFRESH_TOKEN) throw new Error('Bigin is not connected yet. Run npm run bigin:connect to exchange a Self Client authorization code.')
  if (!refreshInFlight) {
    refreshInFlight = tokenRequest({ grant_type: 'refresh_token', refresh_token: process.env.BIGIN_REFRESH_TOKEN }).finally(() => { refreshInFlight = undefined })
  }
  await refreshInFlight
  return cachedToken
}

export async function checkConnection() {
  const results = []
  for (const [module, fields] of [['Contacts', 'Last_Name'], ['Pipelines', 'Deal_Name']]) {
    let token = await getAccessToken()
    const request = () => fetch(`${token.apiDomain}/bigin/v2/${module}?fields=${fields}&per_page=1`, {
      headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}` },
      signal: AbortSignal.timeout(20000), redirect: 'error',
    })
    let response = await request()
    if (response.status === 401) {
      cachedToken = undefined
      token = await getAccessToken()
      response = await request()
    }
    if (!response.ok) throw new Error(`${module} read check failed (HTTP ${response.status}). Verify module read scopes and Bigin permissions.`)
    // Do not print CRM records or personal information.
    results.push(`${module}: read access confirmed${response.status === 204 ? ' (no records)' : ''}`)
  }
  return results
}
