import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CustomAdblockRuleStore,
  isAllowedScope,
  normalizeDomain,
  splitSelectors,
  validateRuleInput
} from '../customRules'

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

  it('rejects public and private suffixes as a rule scope', () => {
    for (const value of ['co.uk', 'github.io']) {
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

  it('rejects the from and to aliases that choose a scope too', () => {
    for (const value of [
      '||cdn.example.invalid^$from=other.com',
      '||cdn.example.invalid^$third-party,to=other.com',
      '||cdn.example.invalid^$~domain=other.com'
    ]) {
      expect(() => validateRuleInput({ domain: 'example.com', kind: 'network', value }), value).toThrow()
    }
  })

  it('finds the option boundary the engine uses, not an escaped dollar', () => {
    const value = '||cdn.example.invalid^$domain=other.com|foo\\$bar'
    expect(() => validateRuleInput({ domain: 'example.com', kind: 'network', value })).toThrow('domain')
  })

  it('keeps a regex filter intact: its anchor is not an option separator', () => {
    expect(validateRuleInput({ domain: 'example.com', kind: 'network', value: '/pixel$/' }).value).toBe('/pixel$/')
    expect(validateRuleInput({ domain: 'example.com', kind: 'network', value: '/pixel/$third-party' }).value).toBe(
      '/pixel/$third-party'
    )
  })

  it('only allows the page host or its registrable domain as a scope', () => {
    expect(isAllowedScope('merchant.co.uk', 'merchant.co.uk')).toBe(true)
    expect(isAllowedScope('www.example.com', 'www.example.com')).toBe(true)
    expect(isAllowedScope('www.example.com', 'example.com')).toBe(true)
    expect(isAllowedScope('merchant.co.uk', 'co.uk')).toBe(false)
    expect(isAllowedScope('shop.github.io', 'github.io')).toBe(false)
    expect(isAllowedScope('www.example.com', 'other.com')).toBe(false)
  })

  it('rejects selectors that cannot be parsed', () => {
    for (const value of ['.ad[', '.ad:', '.ad)', '.ad(', 'a:not(.ad']) {
      expect(() => validateRuleInput({ domain: 'example.com', kind: 'cosmetic', value }), value).toThrow()
    }
    expect(() =>
      validateRuleInput({ domain: 'example.com', kind: 'cosmetic', value: 'a[href^="http:"]::before' })
    ).not.toThrow()
  })

  it('splits a selector list only on top-level commas', () => {
    expect(splitSelectors('.ad, .promo')).toEqual(['.ad', '.promo'])
    expect(splitSelectors(':is(.ad, .promo) > .x')).toEqual([':is(.ad, .promo) > .x'])
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

  it('keeps the saved note when the rule is added again without one', async () => {
    await store.add({ domain: 'example.com', kind: 'cosmetic', value: '.ad', note: 'newsletter overlay' })
    const again = await store.add({ domain: 'example.com', kind: 'cosmetic', value: '.ad' })

    expect(again.existing).toBe(true)
    expect(again.rule.note).toBe('newsletter overlay')
    expect(store.list()[0].note).toBe('newsletter overlay')
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

  it('keeps memory unchanged when a mutation cannot be persisted', async () => {
    const { mkdir } = await import('node:fs/promises')
    const { rule } = await store.add({ domain: 'example.com', kind: 'cosmetic', value: '#ad' })
    // A directory at the temp path makes every write fail before the rename.
    await mkdir(path.join(directory, 'rules.json.tmp'))

    await expect(store.remove(rule.id)).rejects.toThrow()
    await expect(store.setEnabled(rule.id, false)).rejects.toThrow()
    await expect(store.add({ domain: 'example.com', kind: 'cosmetic', value: '.promo' })).rejects.toThrow()

    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].enabled).toBe(true)

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
