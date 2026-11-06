declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  import type { MainModule } from 'libheif-js/libheif-wasm/libheif.js'

  const factory: (options?: unknown) => Promise<MainModule>
  export default factory
}
