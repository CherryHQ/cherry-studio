import { describe, expect, it } from 'vitest'

import { fetchRemoteSkill } from '../skillRemoteSource'

/**
 * Validation-boundary tests for the Gitea fetcher (#20206, spec AC4): a malformed identifier must
 * be rejected before anything is written to disk, so no temp directory is ever opened. The
 * network/git round-trip itself is covered by the install integration environment.
 */
describe('fetchRemoteSkill gitea source', () => {
  it.each([
    ['a non-URL identifier', 'not-a-url'],
    ['a plain-HTTP URL', 'http://gitea.example.com/o/r/src/branch/main/SKILL.md'],
    ['embedded credentials', 'https://user:pass@gitea.example.com/o/r/src/branch/main/SKILL.md'],
    ['a bare repository URL', 'https://gitea.example.com/o/r'],
    ['a tag route', 'https://gitea.example.com/o/r/src/tag/v1/skills/x/SKILL.md'],
    ['a non-descriptor file', 'https://gitea.example.com/o/r/src/branch/main/README.md']
  ])('rejects %s before resolving anything', (_case, identifier) => {
    return expect(fetchRemoteSkill('gitea', identifier)).rejects.toThrow('Invalid Gitea skill URL')
  })

  it('rejects an unknown source without touching the gitea fetcher', () => {
    return expect(fetchRemoteSkill('gitea-mirror', 'https://gitea.example.com/o/r/src/branch/main/SKILL.md')).rejects.toThrow(
      'Unknown install source'
    )
  })
})
