import { describe, expect, it } from 'vitest'

import { compareMigrationChains } from '../migrationChain'

const A = { folderMillis: 1, hash: 'a' }
const B = { folderMillis: 2, hash: 'b' }
const C = { folderMillis: 3, hash: 'c' }
const D = { folderMillis: 4, hash: 'd' }
const BPrime = { ...B, hash: 'other' }

describe('compareMigrationChains', () => {
  it.each([
    [[A, B], [A, B], 'in-sync'],
    [[A], [A, B], 'behind'],
    [[A, B, C], [A, B], 'ahead'],
    [[A, BPrime, C], [A, B, C], 'forked'],
    [[A, BPrime, C, D], [A, B, C], 'forked'],
    [[A, BPrime], [A, B, C], 'forked'],
    [[A, { ...B, folderMillis: 5 }], [A, B], 'forked'],
    [[], [A], 'behind'],
    [[], [], 'in-sync'],
    [[A], [], 'ahead']
  ] as const)('compares %j with %j', (applied, bundled, expected) => {
    const before = structuredClone([applied, bundled])
    expect(compareMigrationChains(applied, bundled)).toBe(expected)
    expect([applied, bundled]).toEqual(before)
  })
})
