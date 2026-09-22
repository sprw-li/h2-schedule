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
  /**
   * 白名单：只允许非秘密的 CLab 根地址进包。
   * 校内账密走本机 localStorage（src/lib/origin.ts），绝不内联；
   * 即便以后有人往 .env 里再加 VITE_CAMPUS_USER/PASS，也匹配不到前缀、进不了产物。
   */
  envPrefix: ['VITE_CAMPUS_ORIGIN'],
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
  },
})
