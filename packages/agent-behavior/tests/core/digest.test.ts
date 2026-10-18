import { expect, it } from 'vitest'

import { sha256Hex } from '../../src/core/digest'
import { withoutEnvironment } from './purity'

// Catches a broken SHA-256 (padding at the 55/56/64-byte edges, multi-byte UTF-8 and surrogate pairs): offload file
// names and notification keys would differ between harnesses or collide.
it.each([
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  ],
  ['0'.repeat(55), '9f8ef876f51f5313c91cc3f6b8119af09d8bbdd72098fa149b2780eb3591d6be'],
  ['0'.repeat(56), 'bd03ac1428f0ea86f4b83a731ffc7967bb82866d8545322f888d2f6e857ffc18'],
  ['0'.repeat(64), '60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55'],
  ['子代理 🚀', 'cacbabf0173cd89ebd33474dc45d2471e1a3d325c6486d06f61a74ddb4811039']
])('sha256Hex(%j)', (text, hex) => {
  expect(withoutEnvironment(() => sha256Hex(text))).toBe(hex)
})
