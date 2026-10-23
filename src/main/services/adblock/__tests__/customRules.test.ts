import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CustomAdblockRuleStore, normalizeDomain, scopeNetworkRule, validateRuleInput } from '../customRules'

let directory: string
let store: CustomAdblockRuleStore

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'adblock-rules-'))
  store = new CustomAdblockRuleStore(path.join(directory, 'rules.json'))
  await store.load()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('rule validation', () => {
  it('normalizes a host and keeps the registrable form intact', () => {
    expect(normalizeDomain('  WWW.Example.COM. ')).toBe('www.example.com')
  })

  it('rejects values that are not hostnames', () => {
    for (const value of ['', 'localhost', 'http://example.com', 'example.com/path', 'exa mple.com']) {
      expect(() => normalizeDomain(value), value).toThrow()
    }
  })

  it('accepts selectors but not declarations', () => {
    expect(validateRuleInput({ domain: 'example.com', kind: 'cosmetic', value: '#ad-slot' }).value).toBe('#ad-slot')
    expect(() =>
      validateRuleInput({ domain: 'example.com', kind: 'cosmetic', value: '#ad { display: none }' })
    ).toThrow()
    expect(() =>
      validateRuleInput({ domain: 'example.com', kind: 'cosmetic', value: 'div:has(> .sponsor)' })
    ).not.toThrow()
  })

  it('accepts network rules and rejects element hiding in the wrong field', () => {
    expect(validateRuleInput({ domain: 'example.com', kind: 'network', value: '||ads.example.com^' }).value).toBe(
      '||ads.example.com^'
    )
    expect(() => validateRuleInput({ domain: 'example.com', kind: 'network', value: 'example.com##.ad' })).toThrow()
    expect(() => validateRuleInput({ domain: 'example.com', kind: 'network', value: 'ads example' })).toThrow()
  })

  it('rejects a network rule that carries its own domain option', () => {
    for (const value of [
      '||cdn.example.invalid^$domain=other.com',
      '||cdn.example.invalid^$third-party,domain=other.com',
      '@@||cdn.example.invalid^$DOMAIN=other.com'
    ]) {
      expect(() => validateRuleInput({ domain: 'example.com', kind: 'network', value }), value).toThrow('domain')
    }
  })

  it('scopes a network rule to the saved domain and refuses to compile a conflicting one', () => {
    expect(scopeNetworkRule('||cdn.example.invalid^', 'example.com')).toBe('||cdn.example.invalid^$domain=example.com')
    expect(scopeNetworkRule('||cdn.example.invalid^$third-party', 'example.com')).toBe(
      '||cdn.example.invalid^$third-party,domain=example.com'
    )
    expect(scopeNetworkRule('||cdn.example.invalid^$domain=other.com', 'example.com')).toBeUndefined()
  })
})

describe('CustomAdblockRuleStore', () => {
  it('adds rules, deduplicates them and persists across instances', async () => {
    const first = await store.add({ domain: 'www.example.com', kind: 'cosmetic', value: '.ad-banner', source: 'ai' })
    expect(first.existing).toBe(false)
    expect(first.rule.source).toBe('ai')

    const again = await store.add({ domain: 'www.example.com', kind: 'cosmetic', value: '.ad-banner' })
    expect(again.existing).toBe(true)
    expect(again.rule.id).toBe(first.rule.id)

    const reopened = new CustomAdblockRuleStore(path.join(directory, 'rules.json'))
    await reopened.load()
    expect(reopened.list()).toHaveLength(1)
    expect(reopened.list()[0].value).toBe('.ad-banner')
  })

  it('removes and disables rules', async () => {
    const { rule } = await store.add({ domain: 'example.com', kind: 'cosmetic', value: '#ad' })
    expect((await store.setEnabled(rule.id, false))?.enabled).toBe(false)
    expect(store.list()[0].enabled).toBe(false)
    expect(await store.remove(rule.id)).toBe(true)
    expect(store.list()).toHaveLength(0)
    expect(await store.remove(rule.id)).toBe(false)
  })

  it('drops corrupt entries instead of failing the whole file', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      path.join(directory, 'rules.json'),
      JSON.stringify([
        { domain: 'example.com', kind: 'cosmetic', value: '.ad', enabled: true, createdAt: 1 },
        { domain: 'not a domain', kind: 'cosmetic', value: '.ad', enabled: true, createdAt: 1 }
      ])
    )
    const reopened = new CustomAdblockRuleStore(path.join(directory, 'rules.json'))
    await reopened.load()
    expect(reopened.list()).toHaveLength(1)
  })

  it('serializes concurrent mutations so every write and rename succeeds', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.add({ domain: 'example.com', kind: 'cosmetic', value: `.ad-${index}` })
      )
    )

    expect(results.every((result) => result.existing === false)).toBe(true)
    expect(store.list()).toHaveLength(12)

    const reopened = new CustomAdblockRuleStore(path.join(directory, 'rules.json'))
    await reopened.load()
    expect(reopened.list()).toHaveLength(12)
  })
})
