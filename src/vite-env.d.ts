/// <reference types="vite/client" />

declare const __H2_BUILT_AT__: string

interface ImportMetaEnv {
  readonly VITE_CAMPUS_ORIGIN?: string
  readonly VITE_CAMPUS_USER?: string
  readonly VITE_CAMPUS_PASS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.jpg' {
  const src: string
  export default src
}
