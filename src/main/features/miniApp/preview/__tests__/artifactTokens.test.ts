import { describe, expect, it } from 'vitest'

import {
  findLatestArtifactToken,
  ArtifactTokenError,
  expectArtifactToken,
  getArtifactTokenRecord,
  issueArtifactToken,
  revokeArtifactToken,
  revokeSessionArtifactTokens
} from '../artifactTokens'

describe('artifactTokens', () => {
  it('issues a token that resolves back to its record', () => {
    const record = issueArtifactToken({
      sessionId: 'session-issue',
      packagePath: '/pkg/a.miniapp',
      sha256: 'sha256:aaa',
      size: 10
    })

    expect(record.token).toMatch(/^art_[0-9a-f]{32}$/)
    expect(getArtifactTokenRecord(record.token)).toEqual(record)
    expect(expectArtifactToken(record.token, 'session-issue')).toEqual(record)
  })

  it('never issues the same token twice', () => {
    const a = issueArtifactToken({
      sessionId: 'session-unique',
      packagePath: '/pkg/a.miniapp',
      sha256: 'sha256:a',
      size: 1
    })
    const b = issueArtifactToken({
      sessionId: 'session-unique',
      packagePath: '/pkg/a.miniapp',
      sha256: 'sha256:a',
      size: 1
    })
    expect(a.token).not.toBe(b.token)
  })

  it('rejects an unknown token', () => {
    expect(() => expectArtifactToken('art_0000000000000000000000000000dead', 'session-x')).toThrowError(
      ArtifactTokenError
    )
    expect(() => expectArtifactToken('art_0000000000000000000000000000dead', 'session-x')).toThrowError(
      expect.objectContaining({ code: 'unknown-token' })
    )
  })

  it('binds the token to the session that validated it', () => {
    const record = issueArtifactToken({
      sessionId: 'session-owner',
      packagePath: '/pkg/b.miniapp',
      sha256: 'sha256:bbb',
      size: 20
    })

    expect(() => expectArtifactToken(record.token, 'session-other')).toThrowError(
      expect.objectContaining({ code: 'session-mismatch' })
    )
    expect(() => expectArtifactToken(record.token, 'session-owner')).not.toThrow()
  })

  it('revokes a single token', () => {
    const record = issueArtifactToken({
      sessionId: 'session-revoke',
      packagePath: '/pkg/c.miniapp',
      sha256: 'sha256:ccc',
      size: 30
    })

    expect(revokeArtifactToken(record.token)).toBe(true)
    expect(revokeArtifactToken(record.token)).toBe(false)
    expect(getArtifactTokenRecord(record.token)).toBeUndefined()
  })

  it('revokes every token a session holds, and only that session\u2019s', () => {
    const mine = issueArtifactToken({
      sessionId: 'session-teardown',
      packagePath: '/pkg/d.miniapp',
      sha256: 'sha256:d1',
      size: 1
    })
    const mineToo = issueArtifactToken({
      sessionId: 'session-teardown',
      packagePath: '/pkg/e.miniapp',
      sha256: 'sha256:d2',
      size: 2
    })
    const theirs = issueArtifactToken({
      sessionId: 'session-neighbor',
      packagePath: '/pkg/f.miniapp',
      sha256: 'sha256:d3',
      size: 3
    })

    expect(revokeSessionArtifactTokens('session-teardown')).toBe(2)
    expect(getArtifactTokenRecord(mine.token)).toBeUndefined()
    expect(getArtifactTokenRecord(mineToo.token)).toBeUndefined()
    expect(expectArtifactToken(theirs.token, 'session-neighbor')).toEqual(theirs)
  })

  it("findLatestArtifactToken finds the session's newest token for one path only", () => {
    const older = issueArtifactToken({
      sessionId: 'session-find',
      packagePath: '/pkg/g.miniapp',
      sha256: 'sha256:g1',
      size: 1
    })
    const newer = issueArtifactToken({
      sessionId: 'session-find',
      packagePath: '/pkg/g.miniapp',
      sha256: 'sha256:g2',
      size: 2
    })
    issueArtifactToken({ sessionId: 'session-find', packagePath: '/pkg/h.miniapp', sha256: 'sha256:h1', size: 3 })
    issueArtifactToken({ sessionId: 'session-other', packagePath: '/pkg/g.miniapp', sha256: 'sha256:g3', size: 4 })

    expect(findLatestArtifactToken('session-find', '/pkg/g.miniapp')?.token).toBe(newer.token)
    expect(newer.createdAt).toBeGreaterThanOrEqual(older.createdAt)
    expect(findLatestArtifactToken('session-find', '/pkg/never.miniapp')).toBeUndefined()
    // Another session's token for the same path is not visible.
    expect(findLatestArtifactToken('session-stranger', '/pkg/g.miniapp')).toBeUndefined()
  })
})
