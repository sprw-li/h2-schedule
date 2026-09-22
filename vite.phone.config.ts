import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const builtAt = '__H2_BUILT_AT_PLACEHOLDER__'

/** Vite 会把 public/schedule.json 拷进 phone/；APK 不得带全量课表当无网兜底。 */
function omitBundledSchedule(): Plugin {
  let outDir = 'phone'
  return {
    name: 'omit-bundled-schedule',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const file = join(outDir, 'schedule.json')
      if (existsSync(file)) unlinkSync(file)
    },
  }
}

/**
 * 公开产物只许内联 VITE_CAMPUS_ORIGIN（CLab 根地址，非秘密）。
 * 其余 VITE_*（尤其账密）即便有人新加了 .env 也不得进包，避免静默回归。
 */
function definePublicEnv() {
  const origin = process.env.VITE_CAMPUS_ORIGIN ?? ''
  return { 'import.meta.env.VITE_CAMPUS_ORIGIN': JSON.stringify(origin) }
}

// 单文件 HTML：装进 APK；之后靠 docs/ota 联网装配，不必天天重装
export default defineConfig({
  plugins: [react(), viteSingleFile(), omitBundledSchedule()],
  base: './',
  define: {
    __H2_BUILT_AT__: JSON.stringify(builtAt),
  },
  // 白名单：只加载非秘密的 CLab 根地址；VITE_CAMPUS_USER/PASS 即便在 .env 里也进不了包
  envPrefix: ['VITE_CAMPUS_ORIGIN'],
  build: {
    outDir: 'phone',
    assetsInlineLimit: 100000000,
  },
})
