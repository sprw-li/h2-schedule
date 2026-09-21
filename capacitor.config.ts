import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cn.sprwli.h2schedule',
  appName: 'H2日程',
  // UI 打进 APK：校园网走 CLab；github.io 作第二源
  webDir: 'phone',
  android: {
    allowMixedContent: true,
  },
}

export default config
