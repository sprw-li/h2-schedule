import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const builtAt = new Date().toISOString()

// 单文件 HTML：装进 APK；之后靠 docs/ota 联网装配，不必天天重装
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  define: {
    __H2_BUILT_AT__: JSON.stringify(builtAt),
  },
  build: {
    outDir: 'phone',
    assetsInlineLimit: 100000000,
  },
})
