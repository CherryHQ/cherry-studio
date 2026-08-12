import { buildGithubSkillResult, parseGithubSkillUrl, resolveRefFromSegments } from '@shared/utils/skillMarketplace'
import { describe, expect, it } from 'vitest'

describe('parseGithubSkillUrl', () => {
  it('reads owner, repo and the undivided ref-and-path from a blob URL', () => {
    expect(
      parseGithubSkillUrl('https://github.com/Viy1204/recruiting-copilot/blob/main/skills/resume-review/SKILL.md')
    ).toEqual({
      owner: 'Viy1204',
      repo: 'recruiting-copilot',
      refAndDirectory: ['main', 'skills', 'resume-review'],
      name: 'resume-review'
    })
  })

  it('accepts the raw.githubusercontent.com form and lowercase skill.md', () => {
    expect(parseGithubSkillUrl('https://raw.githubusercontent.com/owner/repo/v2.1/plugins/a/b/skill.md')).toEqual({
      owner: 'owner',
      repo: 'repo',
      refAndDirectory: ['v2.1', 'plugins', 'a', 'b'],
      name: 'b'
    })
  })

  it.each([
    ['a repo root URL', 'https://github.com/owner/repo'],
    ['a directory URL without the file', 'https://github.com/owner/repo/tree/main/skills/foo'],
    ['a tree URL, which denotes a directory', 'https://github.com/owner/repo/tree/main/skills/foo/SKILL.md'],
    ['a filename the installer does not look for', 'https://github.com/owner/repo/blob/main/skills/foo/SKILL.MD'],
    ['a different file in the skill directory', 'https://github.com/owner/repo/blob/main/skills/foo/README.md'],
    ['a SKILL.md at the repo root', 'https://github.com/owner/repo/blob/main/SKILL.md'],
    ['a non-github host', 'https://gitlab.com/owner/repo/blob/main/skills/foo/SKILL.md'],
    ['a path that escapes the repo', 'https://github.com/owner/repo/blob/main/skills/../../etc/SKILL.md'],
    ['a segment hiding a separator', 'https://github.com/owner/repo/blob/main/skills/foo%2F../SKILL.md'],
    ['plain keywords', 'resume review']
  ])('rejects %s', (_case, url) => {
    expect(parseGithubSkillUrl(url)).toBeNull()
  })

  // `new URL` accepts every one of these; decoding them throws. Callers validate input during
  // render, so a raised URIError would replace the inline error with a crash.
  it.each(['%', '%ZZ', '%E0%A4%A'])('returns null for malformed percent-encoding (%s) instead of throwing', (bad) => {
    const url = `https://github.com/o/r/blob/main/skills/${bad}/SKILL.md`

    expect(() => parseGithubSkillUrl(url)).not.toThrow()
    expect(parseGithubSkillUrl(url)).toBeNull()
  })

  it('decodes escaped directory names', () => {
    expect(parseGithubSkillUrl('https://github.com/o/r/blob/main/skills/foo%23bar/SKILL.md')?.refAndDirectory).toEqual([
      'main',
      'skills',
      'foo#bar'
    ])
  })
})

describe('buildGithubSkillResult', () => {
  it('canonicalizes a raw URL so the same skill yields one install source', () => {
    const fromRaw = buildGithubSkillResult('https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md')
    const fromBlob = buildGithubSkillResult('https://github.com/owner/repo/blob/main/skills/foo/SKILL.md')

    expect(fromRaw?.installSource).toBe('github:https://github.com/owner/repo/blob/main/skills/foo/SKILL.md')
    expect(fromRaw).toEqual(fromBlob)
    expect(fromRaw?.name).toBe('foo')
    expect(fromRaw?.sourceRegistry).toBe('github')
  })

  it('returns null for input the installer could not resolve', () => {
    expect(buildGithubSkillResult('https://github.com/owner/repo')).toBeNull()
  })

  // A raw `#` would turn the rest of the URL into a fragment, `?` into a query and `%` would throw on
  // the way back, so the install side would reject a row the UI had already offered.
  it.each(['foo%23bar', 'foo%3Fbar', 'foo%25bar', 'foo bar'])(
    'produces an install source the installer can parse back (%s)',
    (segment) => {
      const url = `https://github.com/o/r/blob/main/skills/${segment}/SKILL.md`
      const result = buildGithubSkillResult(url)

      expect(result).not.toBeNull()
      expect(parseGithubSkillUrl(result!.installSource.slice('github:'.length))).toEqual(parseGithubSkillUrl(url))
    }
  )
})

describe('resolveRefFromSegments', () => {
  const head = (name: string, oid = 'a'.repeat(40)) => ({ name, oid, namespace: 'heads' as const })

  it('prefers the longest ref the remote actually has', () => {
    // Both refs exist; splitting at the first segment would fetch `feature` and look for
    // `foo/skills/demo` there.
    expect(
      resolveRefFromSegments(
        [head('feature'), head('feature/foo', 'b'.repeat(40))],
        ['feature', 'foo', 'skills', 'demo']
      )
    ).toEqual({ kind: 'resolved', ref: head('feature/foo', 'b'.repeat(40)), directoryPath: 'skills/demo' })
  })

  it('reports a repo-root descriptor instead of falling back to a shorter ref', () => {
    // `feature/foo` consumes every segment, so the URL names SKILL.md at that branch's root. Falling
    // through to `feature` would install `foo/SKILL.md` from an unrelated revision.
    expect(resolveRefFromSegments([head('feature'), head('feature/foo')], ['feature', 'foo'])).toEqual({
      kind: 'repo-root',
      ref: head('feature/foo')
    })
  })

  it('refuses a name carried by both a branch and a tag', () => {
    expect(
      resolveRefFromSegments(
        [head('v1'), { name: 'v1', oid: 'c'.repeat(40), namespace: 'tags' }],
        ['v1', 'skills', 'demo']
      )
    ).toEqual({ kind: 'ambiguous', name: 'v1' })
  })

  it('carries the observed commit so the install cannot follow a moved branch', () => {
    const resolution = resolveRefFromSegments([head('main', 'f'.repeat(40))], ['main', 'skills', 'demo'])
    expect(resolution).toMatchObject({ kind: 'resolved', ref: { oid: 'f'.repeat(40) } })
  })

  it('reports no match rather than guessing a boundary', () => {
    expect(resolveRefFromSegments([head('main')], ['a1b2c3', 'skills', 'demo'])).toEqual({ kind: 'no-match' })
  })
})
