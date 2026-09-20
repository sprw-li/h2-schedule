/// <reference types="vite/client" />

declare const __H2_BUILT_AT__: string

interface ImportMetaEnv {
  readonly VITE_CAMPUS_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.jpg' {
  const src: string
  export default src
}
