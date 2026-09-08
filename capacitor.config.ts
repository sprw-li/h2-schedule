import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cn.sprwli.h2schedule',
  appName: 'H2日程',
  // UI 打进 APK：校园网常打不开 github.io，日程仍走 api.github.com
  webDir: 'phone',
}

export default config
