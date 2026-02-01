/**
 * Type declarations for xxhash-wasm
 */

declare module 'xxhash-wasm' {
  interface XxhashAPI {
    h32: (input: string | Uint8Array, seed?: number) => number
    h64: (input: string | Uint8Array, seed?: bigint) => bigint
    h32ToString: (hash: number) => string
    h64ToString: (hash: bigint) => string
    h32Raw: (input: Uint8Array, seed?: number) => number
    h64Raw: (input: Uint8Array, seed?: bigint) => bigint
    create32: () => {
      init: (seed?: number) => void
      update: (input: Uint8Array) => void
      digest: () => number
    }
    create64: () => {
      init: (seed?: bigint) => void
      update: (input: Uint8Array) => void
      digest: () => bigint
    }
  }

  const xxhash: () => Promise<XxhashAPI>
  export default xxhash
}
