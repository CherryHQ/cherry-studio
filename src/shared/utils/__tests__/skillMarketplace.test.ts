import { describe, expect, it } from 'vitest'

import { buildGithubSkillResult, parseGithubSkillUrl } from '@shared/utils/skillMarketplace'

describe('parseGithubSkillUrl', () => {
  it('reads owner, repo and the undivided ref-and-path from a blob URL', () => {
    expect(
      parseGithubSkillUrl('https://github.com/Viy1204/recruiting-copilot/blob/main/skills/resume-review/SKILL.md')
    ).toEqual({
      owner: 'Viy1204',
      repo: 'recruiting-copilot',
      refNamespace: null,
      refAndPath: ['main', 'skills', 'resume-review'],
      descriptorFileName: 'SKILL.md'
    })
  })

  it('accepts the raw.githubusercontent.com form and lowercase skill.md', () => {
    expect(parseGithubSkillUrl('https://raw.githubusercontent.com/owner/repo/v2.1/plugins/a/b/skill.md')).toEqual({
      owner: 'owner',
      repo: 'repo',
      refNamespace: null,
      refAndPath: ['v2.1', 'plugins', 'a', 'b'],
      descriptorFileName: 'skill.md'
    })
  })

  it('accepts a SKILL.md at the repository root', () => {
    expect(parseGithubSkillUrl('https://github.com/owner/repo/blob/main/SKILL.md')).not.toBeNull()
  })

  it.each([
    'https://github.com/owner/repo/raw/refs/heads/main/SKILL.md',
    'https://raw.githubusercontent.com/owner/repo/refs/heads/main/SKILL.md'
  ])('normalizes an official raw URL (%s)', (url) => {
    expect(parseGithubSkillUrl(url)).toEqual({
      owner: 'owner',
      repo: 'repo',
      refNamespace: 'heads',
      refAndPath: ['main'],
      descriptorFileName: 'SKILL.md'
    })
  })

  it.each([
    ['a repo root URL', 'https://github.com/owner/repo'],
    ['a directory URL without the file', 'https://github.com/owner/repo/tree/main/skills/foo'],
    ['a tree URL, which denotes a directory', 'https://github.com/owner/repo/tree/main/skills/foo/SKILL.md'],
    ['a filename the installer does not look for', 'https://github.com/owner/repo/blob/main/skills/foo/SKILL.MD'],
    ['a different file in the skill directory', 'https://github.com/owner/repo/blob/main/skills/foo/README.md'],
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
    expect(parseGithubSkillUrl('https://github.com/o/r/blob/main/skills/foo%23bar/SKILL.md')?.refAndPath).toEqual([
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
    expect(fromRaw?.name).toBe('repo')
    expect(fromRaw?.sourceRegistry).toBe('github')
  })

  it('preserves a lowercase descriptor filename in the canonical install source', () => {
    expect(
      buildGithubSkillResult('https://raw.githubusercontent.com/owner/repo/main/skills/foo/skill.md')?.installSource
    ).toBe('github:https://github.com/owner/repo/blob/main/skills/foo/skill.md')
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
