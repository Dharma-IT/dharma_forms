import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

export function localMigration(): Plugin {
  return { name: 'local-migration-downloads', apply: 'serve', configureServer(server) {
    const root = resolve(server.config.root, process.env.MIGRATION_ROOT || '.migration-local')
    server.middlewares.use('/__local-migration', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const address = req.socket.remoteAddress ?? ''
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) { res.statusCode = 403; res.end('Local access only'); return }
      if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      try {
        if (path === '/special-known-contacts') {
          const emails = new Set<string>()
          for (const directory of await readdir(root)) {
            if (!/^parent-contact-repair-[a-f0-9]+$/.test(directory)) continue
            try {
              const results = JSON.parse(await readFile(resolve(root, directory, 'results.json'), 'utf8')) as Record<string, { status: string; email: string }>
              for (const row of Object.values(results)) if (['created', 'existing'].includes(row.status)) emails.add(row.email)
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ emails: [...emails] }))
          return
        }
        if (path === '/status') {
          let summary
          try { summary = JSON.parse(await readFile(resolve(root, 'exports/summary.json'), 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          const count = async (directory: string) => { try { return (await readdir(resolve(root, directory))).filter(f => f.endsWith('.json') && (directory !== 'search-pages' || f.startsWith('data-'))).length } catch { return 0 } }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(summary?.reviewByPipeline ? { status: 'ready', ...summary } : { status: 'processing', sourcePages: await count('search-pages'), associationBatches: await count('associations'), contactBatches: await count('contacts') }))
          return
        }
        const filename = path.replace(/^\/files\//, '')
        if (!path.startsWith('/files/') || !/^(?:(?:new-leads|customer-service)-(?:\d+|review|audit|products|associated-products|associated-products-completed|financial-audit|skipped-special|retry)\.csv|review\.csv|audit\.csv|duplicate-review\.csv|contacts-(?:new-\d+|review|audit)\.csv|summary\.json)$/.test(filename)) { res.statusCode = 404; res.end(); return }
        // Only offer completed exports, never raw source caches or credentials.
        await readFile(resolve(root, 'exports/summary.json'), 'utf8')
        const file = await readFile(resolve(root, 'exports', filename))
        res.setHeader('Content-Type', filename.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/json')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
        res.end(file)
      } catch (error) { res.statusCode = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500; res.end('Local migration file unavailable') }
    })
  } }
}


