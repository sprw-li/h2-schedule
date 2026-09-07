import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 单文件 HTML：拷到手机后用浏览器打开，电脑关机也能用。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'phone',
    assetsInlineLimit: 100000000,
  },
})
