import { buildGithubSkillResult, parseGithubSkillUrl } from '@shared/utils/skillMarketplace'
import { describe, expect, it } from 'vitest'

describe('parseGithubSkillUrl', () => {
  it('reads owner, repo, ref and skill directory from a blob URL', () => {
    expect(
      parseGithubSkillUrl('https://github.com/Viy1204/recruiting-copilot/blob/main/skills/resume-review/SKILL.md')
    ).toEqual({
      owner: 'Viy1204',
      repo: 'recruiting-copilot',
      ref: 'main',
      directoryPath: 'skills/resume-review',
      name: 'resume-review'
    })
  })

  it('accepts the raw.githubusercontent.com form and lowercase skill.md', () => {
    expect(parseGithubSkillUrl('https://raw.githubusercontent.com/owner/repo/v2.1/plugins/a/b/skill.md')).toEqual({
      owner: 'owner',
      repo: 'repo',
      ref: 'v2.1',
      directoryPath: 'plugins/a/b',
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
    ['plain keywords', 'resume review']
  ])('rejects %s', (_case, url) => {
    expect(parseGithubSkillUrl(url)).toBeNull()
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
})
