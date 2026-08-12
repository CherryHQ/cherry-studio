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
    ['a different file in the skill directory', 'https://github.com/owner/repo/blob/main/skills/foo/README.md'],
    ['a SKILL.md at the repo root', 'https://github.com/owner/repo/blob/main/SKILL.md'],
    ['a non-github host', 'https://gitlab.com/owner/repo/blob/main/skills/foo/SKILL.md'],
    ['a path that escapes the repo', 'https://github.com/owner/repo/blob/main/skills/../../etc/SKILL.md'],
    ['a segment hiding a separator', 'https://github.com/owner/repo/blob/main/skills/foo%2F../SKILL.md'],
    ['plain keywords', 'resume review']
  ])('rejects %s', (_case, url) => {
    expect(parseGithubSkillUrl(url)).toBeNull()
  })

  it('returns null for malformed percent-encoding instead of throwing', () => {
    // `new URL` accepts a lone `%`; decoding it throws. Callers validate input during render, so a
    // raised URIError would replace the inline error with a crash.
    expect(() => parseGithubSkillUrl('https://github.com/o/r/blob/main/skills/%/SKILL.md')).not.toThrow()
    expect(parseGithubSkillUrl('https://github.com/o/r/blob/main/skills/%/SKILL.md')).toBeNull()
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
  it('prefers the longest ref the remote actually has', () => {
    // Both refs exist; splitting at the first segment would clone `feature` and look for
    // `foo/skills/demo` there.
    expect(resolveRefFromSegments(['feature', 'feature/foo'], ['feature', 'foo', 'skills', 'demo'])).toEqual({
      ref: 'feature/foo',
      directoryPath: 'skills/demo'
    })
  })

  it('keeps at least one segment for the skill directory', () => {
    expect(resolveRefFromSegments(['main', 'main/skills'], ['main', 'skills'])).toEqual({
      ref: 'main',
      directoryPath: 'skills'
    })
  })

  it('returns null when no ref matches, rather than guessing a boundary', () => {
    expect(resolveRefFromSegments(['main'], ['a1b2c3', 'skills', 'demo'])).toBeNull()
  })
})
