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

// 单文件 HTML：装进 APK；之后靠 docs/ota 联网装配，不必天天重装
export default defineConfig({
  plugins: [react(), viteSingleFile(), omitBundledSchedule()],
  base: './',
  define: {
    __H2_BUILT_AT__: JSON.stringify(builtAt),
  },
  envPrefix: ['VITE_'],
  build: {
    outDir: 'phone',
    assetsInlineLimit: 100000000,
  },
})
