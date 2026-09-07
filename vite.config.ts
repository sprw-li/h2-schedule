import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pages = process.env.GITHUB_PAGES === 'true'

export default defineConfig({
  plugins: [react()],
  base: pages ? '/h2-schedule/' : '/',
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
  },
})
