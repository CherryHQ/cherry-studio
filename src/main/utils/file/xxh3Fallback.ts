/**
 * Pure-TypeScript XXH3-64 (seed 0) fallback for legacy Windows 7 environments
 * where `@node-rs/xxhash-win32-x64-msvc >= 1.7.1` fails to load due to Rust >= 1.78
 * `WaitOnAddress` / `ProcessPrng` imports. Produces bit-identical digests to
 * `@node-rs/xxhash` `xxh3.xxh64(data, 0n)` across all input lengths.
 */

const MASK32 = 0xffffffffn
const MASK64 = 0xffffffffffffffffn

const PRIME32_1 = 0x9e3779b1n
const PRIME32_2 = 0x85ebca77n
const PRIME32_3 = 0xc2b2ae3dn
const PRIME64_1 = 0x9e3779b185ebca87n
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn
const PRIME64_3 = 0x165667b19e3779f9n
const PRIME64_4 = 0x85ebca77c2b2ae63n
const PRIME64_5 = 0x27d4eb2f165667c5n
const PRIME_MX1 = 0x165667919e3779f9n
const PRIME_MX2 = 0x9fb21c651e98df25n

const SECRET = new Uint8Array([
  0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c, 0xf7, 0x21, 0xad, 0x1c, 0xde, 0xd4, 0x6d,
  0xe9, 0x83, 0x90, 0x97, 0xdb, 0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f, 0xcb, 0x79, 0xe6, 0x4e, 0xcc, 0xc0,
  0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21, 0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0,
  0x35, 0x90, 0xe6, 0x81, 0x3a, 0x26, 0x4c, 0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb, 0x88, 0xd0, 0x65, 0x8b,
  0x1b, 0x53, 0x2e, 0xa3, 0x71, 0x64, 0x48, 0x97, 0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac,
  0xd8, 0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7, 0xc7, 0x0b, 0x4f, 0x1d, 0x8a, 0x51,
  0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31, 0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64, 0xea, 0xc5, 0xac, 0x83, 0x34,
  0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb, 0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49,
  0xd3, 0x16, 0x55, 0x26, 0x29, 0xd4, 0x68, 0x9e, 0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc, 0x8f, 0xf8, 0xb8,
  0xd1, 0x7a, 0xd0, 0x31, 0xce, 0x45, 0xcb, 0x3a, 0x8f, 0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b,
  0x40, 0x7e
])
const SECRET_VIEW = new DataView(SECRET.buffer, SECRET.byteOffset, SECRET.byteLength)

function readU32LE(view: DataView, offset: number): bigint {
  return BigInt(view.getUint32(offset, true))
}

function readU64LE(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true)
}

function bswap32(v: bigint): bigint {
  return (
    (((v & 0xffn) << 24n) | (((v >> 8n) & 0xffn) << 16n) | (((v >> 16n) & 0xffn) << 8n) | ((v >> 24n) & 0xffn)) & MASK32
  )
}

function bswap64(v: bigint): bigint {
  return (
    (((v & 0xffn) << 56n) |
      (((v >> 8n) & 0xffn) << 48n) |
      (((v >> 16n) & 0xffn) << 40n) |
      (((v >> 24n) & 0xffn) << 32n) |
      (((v >> 32n) & 0xffn) << 24n) |
      (((v >> 40n) & 0xffn) << 16n) |
      (((v >> 48n) & 0xffn) << 8n) |
      ((v >> 56n) & 0xffn)) &
    MASK64
  )
}

function rotl64(v: bigint, shift: bigint): bigint {
  return ((v << shift) | (v >> (64n - shift))) & MASK64
}

function xxh64Avalanche(h: bigint): bigint {
  let x = h & MASK64
  x ^= x >> 33n
  x = (x * PRIME64_2) & MASK64
  x ^= x >> 29n
  x = (x * PRIME64_3) & MASK64
  x ^= x >> 32n
  return x
}

function xxh3Avalanche(h: bigint): bigint {
  let x = h & MASK64
  x ^= x >> 37n
  x = (x * PRIME_MX1) & MASK64
  x ^= x >> 32n
  return x
}

function rrmxmx(h: bigint, len: bigint): bigint {
  let x = h & MASK64
  x ^= rotl64(x, 49n) ^ rotl64(x, 24n)
  x = (x * PRIME_MX2) & MASK64
  x ^= (x >> 35n) + len
  x = (x * PRIME_MX2) & MASK64
  return x ^ (x >> 28n)
}

function mul128Fold64(lhs: bigint, rhs: bigint): bigint {
  const product = (lhs & MASK64) * (rhs & MASK64)
  return ((product & MASK64) ^ (product >> 64n)) & MASK64
}

function mix16B(inputView: DataView, inOff: number, secretOff: number): bigint {
  const lo = readU64LE(inputView, inOff)
  const hi = readU64LE(inputView, inOff + 8)
  return mul128Fold64(lo ^ readU64LE(SECRET_VIEW, secretOff), hi ^ readU64LE(SECRET_VIEW, secretOff + 8))
}

function accumulate512(acc: BigUint64Array, inputView: DataView, inOff: number, secretOff: number): void {
  for (let i = 0; i < 8; i += 1) {
    const dataVal = readU64LE(inputView, inOff + 8 * i)
    const dataKey = dataVal ^ readU64LE(SECRET_VIEW, secretOff + 8 * i)
    acc[i ^ 1] = (acc[i ^ 1] + dataVal) & MASK64
    acc[i] = (acc[i] + (dataKey & MASK32) * (dataKey >> 32n)) & MASK64
  }
}

function scrambleAcc(acc: BigUint64Array, secretOff: number): void {
  for (let i = 0; i < 8; i += 1) {
    let a = acc[i]
    a ^= a >> 47n
    a ^= readU64LE(SECRET_VIEW, secretOff + 8 * i)
    acc[i] = (a * PRIME32_1) & MASK64
  }
}

function mergeAccs(acc: BigUint64Array, secretOff: number, start: bigint): bigint {
  let result = start & MASK64
  for (let i = 0; i < 4; i += 1) {
    const lhs = acc[2 * i] ^ readU64LE(SECRET_VIEW, secretOff + 16 * i)
    const rhs = acc[2 * i + 1] ^ readU64LE(SECRET_VIEW, secretOff + 16 * i + 8)
    result = (result + mul128Fold64(lhs, rhs)) & MASK64
  }
  return xxh3Avalanche(result)
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? Buffer.from(data, 'utf8') : data
}

/** Compute one-shot XXH3-64 digest with seed 0 in pure TypeScript. */
export function xxh3_64Fallback(data: Uint8Array | string): bigint {
  const bytes = toBytes(data)
  const len = bytes.length
  const lenBig = BigInt(len)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (len === 0) {
    return xxh64Avalanche(readU64LE(SECRET_VIEW, 56) ^ readU64LE(SECRET_VIEW, 64))
  }
  if (len <= 3) {
    const c1 = BigInt(bytes[0])
    const c2 = BigInt(bytes[len >> 1])
    const c3 = BigInt(bytes[len - 1])
    const combined = ((c1 << 16n) | (c2 << 24n) | c3 | (lenBig << 8n)) & MASK32
    const bitflip = (readU32LE(SECRET_VIEW, 0) ^ readU32LE(SECRET_VIEW, 4)) & MASK64
    return xxh64Avalanche(combined ^ bitflip)
  }
  if (len <= 8) {
    const inLo = readU32LE(view, 0)
    const inHi = readU32LE(view, len - 4)
    const input64 = (inHi + (inLo << 32n)) & MASK64
    const bitflip = (readU64LE(SECRET_VIEW, 8) ^ readU64LE(SECRET_VIEW, 16)) & MASK64
    return rrmxmx(input64 ^ bitflip, lenBig)
  }
  if (len <= 16) {
    const bitflip1 = (readU64LE(SECRET_VIEW, 24) ^ readU64LE(SECRET_VIEW, 32)) & MASK64
    const bitflip2 = (readU64LE(SECRET_VIEW, 40) ^ readU64LE(SECRET_VIEW, 48)) & MASK64
    const inputLo = readU64LE(view, 0) ^ bitflip1
    const inputHi = readU64LE(view, len - 8) ^ bitflip2
    const acc = (lenBig + bswap64(inputLo) + inputHi + mul128Fold64(inputLo, inputHi)) & MASK64
    return xxh3Avalanche(acc)
  }
  if (len <= 128) {
    let acc = (lenBig * PRIME64_1) & MASK64
    if (len > 32) {
      if (len > 64) {
        if (len > 96) {
          acc = (acc + mix16B(view, 48, 96)) & MASK64
          acc = (acc + mix16B(view, len - 64, 112)) & MASK64
        }
        acc = (acc + mix16B(view, 32, 64)) & MASK64
        acc = (acc + mix16B(view, len - 48, 80)) & MASK64
      }
      acc = (acc + mix16B(view, 16, 32)) & MASK64
      acc = (acc + mix16B(view, len - 32, 48)) & MASK64
    }
    acc = (acc + mix16B(view, 0, 0)) & MASK64
    acc = (acc + mix16B(view, len - 16, 16)) & MASK64
    return xxh3Avalanche(acc)
  }
  if (len <= 240) {
    let acc = (lenBig * PRIME64_1) & MASK64
    const nbRounds = len >> 4
    for (let i = 0; i < 8; i += 1) {
      acc = (acc + mix16B(view, 16 * i, 16 * i)) & MASK64
    }
    acc = xxh3Avalanche(acc)
    for (let i = 8; i < nbRounds; i += 1) {
      acc = (acc + mix16B(view, 16 * i, 16 * (i - 8) + 3)) & MASK64
    }
    acc = (acc + mix16B(view, len - 16, 119)) & MASK64
    return xxh3Avalanche(acc)
  }

  const acc = new BigUint64Array([
    PRIME32_3,
    PRIME64_1,
    PRIME64_2,
    PRIME64_3,
    PRIME64_4,
    PRIME32_2,
    PRIME64_5,
    PRIME32_1
  ])
  const stripesPerBlock = (SECRET.length - 64) >> 3
  const blockLen = 64 * stripesPerBlock
  const nbBlocks = Math.floor((len - 1) / blockLen)

  for (let n = 0; n < nbBlocks; n += 1) {
    for (let s = 0; s < stripesPerBlock; s += 1) {
      accumulate512(acc, view, n * blockLen + s * 64, s * 8)
    }
    scrambleAcc(acc, SECRET.length - 64)
  }

  const nbStripes = Math.floor((len - 1 - blockLen * nbBlocks) / 64)
  for (let s = 0; s < nbStripes; s += 1) {
    accumulate512(acc, view, nbBlocks * blockLen + s * 64, s * 8)
  }
  accumulate512(acc, view, len - 64, SECRET.length - 64 - 7)
  return mergeAccs(acc, 11, (lenBig * PRIME64_1) & MASK64)
}

export function createXxh3_64FallbackHasher(): {
  update(chunk: Uint8Array | string): void
  digest(): bigint
} {
  const chunks: Uint8Array[] = []
  return {
    update(chunk) {
      chunks.push(toBytes(chunk))
    },
    digest() {
      return xxh3_64Fallback(Buffer.concat(chunks))
    }
  }
}

export const __internal = { bswap32 }
