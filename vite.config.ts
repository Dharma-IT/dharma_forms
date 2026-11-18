import { localMigration } from './local-migration-plugin.ts'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localMigration()],
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
})


