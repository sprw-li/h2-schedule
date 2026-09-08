import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pages = process.env.GITHUB_PAGES === 'true'
const builtAt = new Date().toISOString()

export default defineConfig({
  plugins: [react()],
  base: pages ? '/h2-schedule/' : '/',
  define: {
    __H2_BUILT_AT__: JSON.stringify(builtAt),
  },
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
  },
})
