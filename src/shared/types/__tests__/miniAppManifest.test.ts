import { describe, expect, it } from 'vitest'

import {
  declaredGrantKeys,
  MINI_APP_MAX_PACKAGE_BYTES,
  MiniAppDistributionManifestSchema,
  MiniAppManifestSchema,
  resolveLocalizedText
} from '../miniAppManifest'

const valid = {
  id: 'com.example.mygame',
  name: 'My Game',
  description: 'A small offline puzzle game. Saves progress locally.',
  version: '1.0.0',
  entry: 'index.html',
  icon: { path: 'icon.png', sha256: 'a'.repeat(64) },
  permissions: ['storage.get', 'storage.set'],
  network: []
}

// Rest-destructuring leaves `_x` bindings that `no-unused-vars` still counts; drop keys explicitly.
const omit = (o: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
describe('MiniAppManifestSchema', () => {
  it('accepts a reverse-DNS id', () => {
    expect(MiniAppManifestSchema.parse(valid).id).toBe('com.example.mygame')
  })

  it.each([
    ['uppercase', 'Com.Example.Game'],
    ['underscore', 'com.example.my_game'],
    ['leading hyphen', 'com.-example.game'],
    ['empty label', 'com..game'],
    ['path separator', 'com/example']
  ])('rejects an id with %s', (_l, id) => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, id })).toThrow()
  })

  it.each([
    ['parent traversal', '../outside.html'],
    ['absolute path', '/etc/passwd'],
    ['reserved dir', '__cherry/index.html']
  ])('rejects an entry with %s', (_l, entry) => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, entry })).toThrow()
  })

  it('accepts a plain string name as meaning "the same in every locale"', () => {
    expect(resolveLocalizedText(MiniAppManifestSchema.parse(valid).name, 'de-DE')).toBe('My Game')
  })

  it.each([
    ['English only', { en: 'My Game' }],
    ['Chinese only', { zh: '我的游戏' }],
    ['both', { en: 'My Game', zh: '我的游戏' }],
    ['both plus an optional extra', { en: 'My Game', zh: '我的游戏', ja: 'マイゲーム' }]
  ])('accepts a name table with %s', (_label, name) => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, name })).not.toThrow()
  })

  it('rejects a name table with neither en nor zh', () => {
    // Without one of them the fallback chain has no terminal, and the displayed name
    // would depend on object key order.
    expect(() => MiniAppManifestSchema.parse({ ...valid, name: { ja: 'マイゲーム' } })).toThrow()
  })

  it('rejects an empty name table', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, name: {} })).toThrow()
  })

  it.each([
    ['exact tag wins', 'zh-CN', { 'zh-CN': '简体', zh: '中文', en: 'English' }, '简体'],
    ['language segment covers regions', 'zh-TW', { zh: '中文', en: 'English' }, '中文'],
    ['unknown locale falls back to en', 'de-DE', { zh: '中文', en: 'English' }, 'English'],
    ['no en falls back to zh', 'de-DE', { zh: '中文' }, '中文'],
    ['zh user with en-only package', 'zh-CN', { en: 'English' }, 'English']
  ])('resolves %s', (_label, locale, table, expected) => {
    expect(resolveLocalizedText(table as never, locale)).toBe(expected)
  })

  it('requires a description', () => {
    // The bug this guards: a consent card that lists permissions with no statement
    // of purpose. The user is then agreeing to capabilities, not to an application.
    expect(() => MiniAppManifestSchema.parse(omit(valid, 'description'))).toThrow()
  })

  it('applies the same en/zh rule to the description', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, description: { ja: '説明' } })).toThrow()
    expect(() => MiniAppManifestSchema.parse({ ...valid, description: { zh: '一个小游戏' } })).not.toThrow()
  })

  it('rejects a description longer than the card can show', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, description: 'x'.repeat(201) })).toThrow()
  })

  it('accepts a packaged manifest with no package block', () => {
    // The archive-root manifest CANNOT carry `package`: its `sha256` is the hash of
    // the archive this very file sits in, so writing it changes it. Unproducible.
    expect(MiniAppManifestSchema.parse(valid).id).toBe(valid.id)
  })

  it('refuses a distribution manifest with no package block', () => {
    // Optional there would leave the download self-certifying — the expected hash is
    // the only thing binding the user's consent to the bytes that land.
    expect(() => MiniAppDistributionManifestSchema.parse(valid)).toThrow()
  })

  it('rejects a package declaring more than the archive limit', () => {
    // The bug this guards: without a schema bound, "verify against the declared
    // size" lets the source declare how much memory it may occupy.
    expect(() =>
      MiniAppDistributionManifestSchema.parse({
        ...valid,
        update: { url: 'https://x/m.json', urlCn: 'https://x.cn/m.json' },
        package: {
          url: 'https://x/p.miniapp',
          urlCn: 'https://x.cn/p.miniapp',
          sha256: 'a'.repeat(64),
          size: MINI_APP_MAX_PACKAGE_BYTES + 1
        }
      })
    ).toThrow()
  })

  it('accepts a package at exactly the archive limit', () => {
    expect(
      MiniAppDistributionManifestSchema.parse({
        ...valid,
        update: { url: 'https://x/m.json', urlCn: 'https://x.cn/m.json' },
        package: {
          url: 'https://x/p.miniapp',
          urlCn: 'https://x.cn/p.miniapp',
          sha256: 'a'.repeat(64),
          size: MINI_APP_MAX_PACKAGE_BYTES
        }
      }).package.size
    ).toBe(MINI_APP_MAX_PACKAGE_BYTES)
  })

  it('expands a namespace wildcard into its grantable leaves', () => {
    const m = MiniAppManifestSchema.parse({ ...valid, permissions: ['storage.*'] })
    expect(declaredGrantKeys(m)).toEqual(['storage.delete', 'storage.get', 'storage.keys', 'storage.set'])
  })

  it('leaves introspection methods out of the expansion', () => {
    // `storage.usage` is `sibling`-gated: not declarable, not revocable. Including it
    // would put a row in the grant table that nothing ever checks.
    const m = MiniAppManifestSchema.parse({ ...valid, permissions: ['storage.*'] })
    expect(declaredGrantKeys(m)).not.toContain('storage.usage')
  })

  it('accepts a single leaf without its siblings', () => {
    const m = MiniAppManifestSchema.parse({ ...valid, permissions: ['file.save', 'file.load'] })
    expect(declaredGrantKeys(m)).toEqual(['file.load', 'file.save'])
  })

  it('does not let a wildcard reach into another namespace', () => {
    const m = MiniAppManifestSchema.parse({ ...valid, permissions: ['file.*'] })
    expect(declaredGrantKeys(m).every((k) => k.startsWith('file.'))).toBe(true)
  })

  it('deduplicates a leaf that its own wildcard already covers', () => {
    const m = MiniAppManifestSchema.parse({ ...valid, permissions: ['file.*', 'file.save'] })
    expect(new Set(declaredGrantKeys(m)).size).toBe(declaredGrantKeys(m).length)
  })

  it.each([
    ['a bare namespace', 'storage'],
    ['an unknown namespace', 'camera.*'],
    ['an unknown method', 'storage.wipe'],
    ['a global wildcard', '*'],
    ['a sibling-gated method', 'storage.usage']
  ])('rejects %s as a declaration', (_label, permission) => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, permissions: [permission] })).toThrow()
  })

  it('rejects an unknown permission', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, permissions: ['fs.root'] })).toThrow()
  })

  it('rejects a network entry that is not a bare hostname', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, network: ['https://a.com/x'] })).toThrow()
  })

  it('rejects hosts that end in a number, which network.fetch always refuses', () => {
    // The bug this guards: the regex accepted these, so an author shipped a manifest that
    // installed cleanly and then had every fetch refused as "a host the manifest declares"
    // — the one message that rules out the actual cause.
    for (const host of ['1.2.3.4', '0x7f.1', 'example.123']) {
      expect(() => MiniAppManifestSchema.parse({ ...valid, permissions: ['network.fetch'], network: [host] })).toThrow(
        /hostname/
      )
    }
    // Digits are fine anywhere but the last label.
    expect(
      MiniAppManifestSchema.parse({ ...valid, permissions: ['network.fetch'], network: ['123.example'] }).network
    ).toEqual(['123.example'])
  })

  it('defaults permissions and network to empty', () => {
    const parsed = MiniAppManifestSchema.parse(omit(valid, 'permissions', 'network'))
    expect(parsed.permissions).toEqual([])
    expect(parsed.network).toEqual([])
  })

  it('refuses hosts without a network permission, and a network permission without hosts', () => {
    // Either alone is an authoring mistake the user would otherwise debug as "the app
    // silently cannot connect". The consistent pair is the positive control.
    expect(() => MiniAppManifestSchema.parse({ ...valid, network: ['api.example.com'] })).toThrow(/network/)
    expect(() => MiniAppManifestSchema.parse({ ...valid, permissions: ['network.fetch'] })).toThrow(/hosts/)
    expect(() =>
      MiniAppManifestSchema.parse({ ...valid, permissions: ['network.fetch'], network: ['api.example.com'] })
    ).not.toThrow()
  })

  it('lets an OPTIONAL network permission satisfy declared hosts', () => {
    // The rule is "can reach the network at all", not "must require it".
    expect(() =>
      MiniAppManifestSchema.parse({ ...valid, optionalPermissions: ['network.fetch'], network: ['api.example.com'] })
    ).not.toThrow()
  })

  it('refuses a leaf declared both required and optional, even through a wildcard', () => {
    // Textually distinct, identical after expansion — the easy way to pass a required
    // permission off as optional on the consent card.
    expect(() =>
      MiniAppManifestSchema.parse({ ...valid, permissions: ['storage.*'], optionalPermissions: ['storage.get'] })
    ).toThrow(/also declared as required/)
  })

  it('refuses duplicate hosts rather than collapsing them', () => {
    expect(() =>
      MiniAppManifestSchema.parse({
        ...valid,
        permissions: ['network.fetch'],
        network: ['api.example.com', 'api.example.com']
      })
    ).toThrow(/unique/)
  })

  it('refuses an id whose first label is a Windows device name, wherever else it appears', () => {
    // `con.example.app` becomes a directory named `con…` and `con….json`; only the FIRST
    // label reaches the filesystem, so `com.example.con` is fine.
    expect(() => MiniAppManifestSchema.parse({ ...valid, id: 'con.example.app' })).toThrow(/reserved/)
    expect(() => MiniAppManifestSchema.parse({ ...valid, id: 'com1.example.app' })).toThrow(/reserved/)
    expect(() => MiniAppManifestSchema.parse({ ...valid, id: 'com.example.con' })).not.toThrow()
  })

  it('requires a semver version so "is this newer" stays decidable', () => {
    expect(() => MiniAppManifestSchema.parse({ ...valid, version: '1.0' })).toThrow(/semver/)
    expect(() => MiniAppManifestSchema.parse({ ...valid, version: 'latest' })).toThrow(/semver/)
    expect(MiniAppManifestSchema.parse({ ...valid, version: '1.10.0-beta.1' }).version).toBe('1.10.0-beta.1')
  })

  it('accepts an update block with or without a China accelerator', () => {
    // Third-party authors are not required to run a mirror; one endpoint is a complete declaration.
    expect(() => MiniAppManifestSchema.parse({ ...valid, update: { url: 'https://x/m.json' } })).not.toThrow()
    expect(() =>
      MiniAppManifestSchema.parse({ ...valid, update: { url: 'https://x/m.json', urlCn: 'https://x.cn/m.json' } })
    ).not.toThrow()
  })

  it('keeps the update and package accelerators both-or-neither in a distribution manifest', () => {
    // A package mirror with no update mirror has no origin to be pinned to; the reverse
    // sends Chinese users to the global package while the manifest promised a mirror.
    const pkg = { url: 'https://x/p.miniapp', sha256: 'a'.repeat(64), size: 1024 }
    expect(() =>
      MiniAppDistributionManifestSchema.parse({ ...valid, update: { url: 'https://x/m.json' }, package: pkg })
    ).not.toThrow()
    expect(() =>
      MiniAppDistributionManifestSchema.parse({
        ...valid,
        update: { url: 'https://x/m.json' },
        package: { ...pkg, urlCn: 'https://x.cn/p.miniapp' }
      })
    ).toThrow(/together/)
    expect(() =>
      MiniAppDistributionManifestSchema.parse({
        ...valid,
        update: { url: 'https://x/m.json', urlCn: 'https://x.cn/m.json' },
        package: pkg
      })
    ).toThrow(/together/)
  })

  it('caps a name table at 20 locales', () => {
    // The per-value cap bounds one string; without this a manifest smuggles hundreds of
    // rows the update preview must diff inside the same byte budget.
    const locales = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`l${i}`, 'x']))
    expect(() => MiniAppManifestSchema.parse({ ...valid, name: { en: 'x', ...locales(19) } })).not.toThrow()
    expect(() => MiniAppManifestSchema.parse({ ...valid, name: { en: 'x', ...locales(20) } })).toThrow(/locales/)
  })
})
