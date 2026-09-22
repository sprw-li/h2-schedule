/// <reference types="vite/client" />

declare const __H2_BUILT_AT__: string

/** 只保留非秘密的 CLab 根地址。校内账密不得走构建时环境变量，只从本机 localStorage 取。 */
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
