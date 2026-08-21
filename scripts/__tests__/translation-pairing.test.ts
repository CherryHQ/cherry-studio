import { describe, expect, it } from 'vitest'

import {
  blobHash,
  pairAnchor,
  pairPaths,
  parseManifest,
  parsePairingArgs,
  parseRecord,
  renderRecord,
  validatePairContent
} from '../translation-pairing'

const normalPair = (description: string, switcher: string, title: string, body = 'Text.'): string =>
  `---\ndescription: ${description}\nsources:\n  - src/main/foo\n---\n\n# ${title}\n\n${switcher}\n\n## Section\n\n${body}\n`

describe('translation pairing helpers', () => {
  it('computes Git blob hashes and normalizes pair arguments', () => {
    expect(blobHash(Buffer.from(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(pairAnchor('.\\docs\\foo.zh.md')).toBe('docs/foo.md')
    expect(pairAnchor('docs/foo.i18n.yaml')).toBe('docs/foo.md')
  })

  it('round-trips canonical sidecars', () => {
    const paths = pairPaths('docs/foo.md')
    const record = { sourceHash: '1'.repeat(40), zhHash: '2'.repeat(40) }
    expect(parseRecord(renderRecord(paths, record), paths)).toEqual(record)
  })

  it('validates CLI write and cached boundaries', () => {
    expect(parsePairingArgs(['--write', 'docs/foo.zh.md'])).toEqual({
      input: 'worktree',
      mode: 'write',
      scope: 'pairs',
      anchors: ['docs/foo.md']
    })
    expect(parsePairingArgs(['--cached', 'docs/foo.i18n.yaml'])).toEqual({
      input: 'index',
      mode: 'check',
      scope: 'pairs',
      anchors: ['docs/foo.md']
    })
    expect(() => parsePairingArgs(['--write'])).toThrow('requires confirmed pair paths')
  })

  it('accepts translated descriptions with identical sources and structure', () => {
    const paths = pairPaths('docs/i18n/README.md')
    const source = normalPair('Pairing rules', 'English | [中文](README.zh.md)', 'Pairing', '- One\n- Two')
    const zh = normalPair('配对规则', '[English](README.md) | 中文', '配对', '- 一\n- 二')
    expect(validatePairContent(paths, Buffer.from(source), Buffer.from(zh))).toEqual([])
  })

  it('rejects source and structural drift', () => {
    const paths = pairPaths('docs/i18n/README.md')
    const source = normalPair('Pairing rules', 'English | [中文](README.zh.md)', 'Pairing', '- One\n- Two')
    const zh = normalPair('配对规则', '[English](README.md) | 中文', '配对', '- 一').replace(
      'src/main/foo',
      'src/main/bar'
    )
    expect(validatePairContent(paths, Buffer.from(source), Buffer.from(zh))).toEqual([
      'frontmatter "sources" must match exactly',
      expect.stringContaining('list structure')
    ])
  })

  it('validates root-only rollout manifests', () => {
    expect(parseManifest('{"roots":[".agents/notes","CONTRIBUTING.md"],"excluded":[]}')).toEqual({
      roots: ['.agents/notes', 'CONTRIBUTING.md'],
      excluded: []
    })
  })
})
