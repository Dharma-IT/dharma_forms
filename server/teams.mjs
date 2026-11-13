import { Pool } from 'pg'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { biginRequest } from './submissions.mjs'

export const teamIds = ['agents', 'nutritionists', 'sellers', 'customer-service']
const seed = teamIds.map(team => ({ team, id: '7692472000000645001', name: 'Jeuz Vinci Bas', bookingUrl: team === 'agents' ? '' : 'https://us.bigin.online/org945767910/bookings/it' }))
const directory = new URL('../.team-settings/', import.meta.url)
const file = new URL('members.json', directory)
let pool
let ready
let queue = Promise.resolve()

async function database() {
  if (!process.env.DATABASE_URL) return null
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL })
  ready ||= (async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS booking_team_members (team text NOT NULL, id text NOT NULL, name text NOT NULL, booking_url text NOT NULL, PRIMARY KEY(team,id))')
    // A separate marker preserves intentionally empty teams after removals.
    await pool.query('CREATE TABLE IF NOT EXISTS booking_team_initialized (id integer PRIMARY KEY)')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const marker = await client.query('INSERT INTO booking_team_initialized VALUES (1) ON CONFLICT DO NOTHING RETURNING id')
      if (marker.rowCount) for (const member of seed) await client.query('INSERT INTO booking_team_members VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [member.team, member.id, member.name, member.bookingUrl])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  })()
  await ready
  return pool
}

export async function getMembers() {
  const db = await database()
  if (db) return (await db.query('SELECT team,id,name,booking_url AS "bookingUrl" FROM booking_team_members ORDER BY name')).rows
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return seed }
}

export async function getBiginUsers(request = biginRequest) {
  const users = []
  for (let page = 1; ; page++) {
    let result
    try { result = await request(`users?type=ActiveConfirmedUsers&page=${page}&per_page=200`) }
    catch (error) {
      if (error.message.includes('permissions need updating')) throw new Error('Bigin user lookup requires ZohoBigin.users.READ. Reconnect with that scope and update the refresh token on Render.')
      throw error
    }
    const rows = result.users || []
    users.push(...rows.map(user => ({ id: user.id, name: user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' '), email: user.email || '' })))
    if (!result.info?.more_records && rows.length < 200) break
  }
  return users
}

export function validateMember(input, users) {
  if (!teamIds.includes(input.team)) throw new Error('Select a valid team.')
  const user = users.find(user => user.id === input.id)
  if (!user) throw new Error('This account was not found among active, confirmed Bigin users.')
  if (typeof input.bookingUrl !== 'string' || input.bookingUrl.length > 2048) throw new Error('Enter a valid calendar link.')
  const bookingUrl = input.bookingUrl.trim()
  if (input.team !== 'agents' && !bookingUrl) throw new Error('A calendar link is required for this team.')
  if (bookingUrl) {
    let url
    try { url = new URL(bookingUrl) } catch { throw new Error('Calendar links must be valid HTTPS URLs.') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Calendar links must be valid HTTPS URLs without credentials.')
  }
  return { team: input.team, id: user.id, name: user.name, bookingUrl }
}

export async function changeMember(input, remove = false) {
  if (!teamIds.includes(input.team) || typeof input.id !== 'string' || !/^\d+$/.test(input.id)) throw new Error('Select a valid team and user.')
  const member = remove ? input : validateMember(input, await getBiginUsers())
  const db = await database()
  if (!db && process.env.RENDER) throw new Error('Configure DATABASE_URL on Render before saving shared team settings.')
  if (db) {
    if (remove) await db.query('DELETE FROM booking_team_members WHERE team=$1 AND id=$2', [member.team, member.id])
    else await db.query('INSERT INTO booking_team_members VALUES ($1,$2,$3,$4) ON CONFLICT(team,id) DO UPDATE SET name=EXCLUDED.name, booking_url=EXCLUDED.booking_url', [member.team, member.id, member.name, member.bookingUrl])
  } else {
    const task = queue.then(async () => {
      const members = (await getMembers()).filter(row => row.team !== member.team || row.id !== member.id)
      if (!remove) members.push(member)
      await mkdir(directory, { recursive: true })
      const temporary = new URL('members.tmp', directory)
      await writeFile(temporary, JSON.stringify(members), { mode: 0o600 })
      await rename(temporary, file)
    })
    queue = task.catch(() => {})
    await task
  }
  return getMembers()
}
