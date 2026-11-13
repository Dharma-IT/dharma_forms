import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { checkConnection, exchangeCode } from './bigin.mjs'

try {
  if (process.argv[2] === 'connect') {
    const prompt = createInterface({ input: stdin, output: stdout })
    try {
      const domain = await prompt.question('Zoho accounts origin [https://accounts.zoho.com]: ')
      process.env.BIGIN_ACCOUNTS_URL = domain.trim() || process.env.BIGIN_ACCOUNTS_URL || 'https://accounts.zoho.com'
      const code = await prompt.question('Paste your newly generated Self Client authorization code: ')
      await exchangeCode(code)
      // Persist the chosen region for later refresh requests.
      const { readFile, writeFile } = await import('node:fs/promises')
      const envFile = new URL('../.env', import.meta.url)
      let env = await readFile(envFile, 'utf8')
      const line = `BIGIN_ACCOUNTS_URL=${process.env.BIGIN_ACCOUNTS_URL}`
      env = /^BIGIN_ACCOUNTS_URL=.*$/m.test(env) ? env.replace(/^BIGIN_ACCOUNTS_URL=.*$/m, line) : `${env.trimEnd()}\n${line}\n`
      await writeFile(envFile, env, { mode: 0o600 })
      console.log('Refresh token saved to .env. Tokens are not printed.')
    } finally { prompt.close() }
  }
  for (const result of await checkConnection()) console.log(result)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
