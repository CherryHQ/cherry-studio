import { resolveTrustedRef } from '../ref'

const refs = [
  { name: 'refs/heads/main', sha: 'main-sha' },
  { name: 'refs/heads/release/v2.1.0', sha: 'release-sha' },
  { name: 'refs/heads/feature/e2e-fix', sha: 'feature-sha' },
  { name: 'refs/tags/preview', sha: 'preview-sha' },
  { name: 'refs/tags/v2.0.8', sha: 'tag-object-sha' },
  { name: 'refs/tags/v2.0.8^{}', sha: 'tag-commit-sha' }
]

describe('trusted ref resolution', () => {
  it('resolves trusted branches and peeled release tags to an exact sha', () => {
    expect(resolveTrustedRef('main', refs)).toEqual({
      kind: 'branch',
      name: 'main',
      ref: 'refs/heads/main',
      sha: 'main-sha'
    })
    expect(resolveTrustedRef('release/v2.1.0', refs).sha).toBe('release-sha')
    expect(resolveTrustedRef('v2.0.8', refs)).toEqual({
      kind: 'tag',
      name: 'v2.0.8',
      ref: 'refs/tags/v2.0.8',
      sha: 'tag-commit-sha'
    })
  })

  it.each(['feature/e2e-fix', 'refs/heads/feature/e2e-fix'])(
    'resolves repository branch %s to the exact advertised commit',
    (requested) => {
      expect(resolveTrustedRef(requested, refs)).toEqual({
        kind: 'branch',
        name: 'feature/e2e-fix',
        ref: 'refs/heads/feature/e2e-fix',
        sha: 'feature-sha'
      })
    }
  )

  it('rejects non-release tags and branches absent from the repository', () => {
    expect(() => resolveTrustedRef('preview', refs)).toThrow('Only v* release tags are supported')
    expect(() => resolveTrustedRef('refs/tags/preview', refs)).toThrow('Only v* release tags are supported')
    expect(() => resolveTrustedRef('fork:feature/e2e-fix', refs)).toThrow('Ref not found')
  })

  it('rejects missing and ambiguous plain refs', () => {
    expect(() => resolveTrustedRef('v9.9.9', refs)).toThrow('Ref not found: v9.9.9')
    expect(() =>
      resolveTrustedRef('v2.0.8', [...refs, { name: 'refs/heads/v2.0.8', sha: 'ambiguous-branch-sha' }])
    ).toThrow('Ref is ambiguous; use refs/heads/... or refs/tags/...: v2.0.8')
    const ambiguous = [...refs, { name: 'refs/heads/v2.0.8', sha: 'ambiguous-branch-sha' }]
    expect(resolveTrustedRef('refs/heads/v2.0.8', ambiguous).sha).toBe('ambiguous-branch-sha')
    expect(resolveTrustedRef('refs/tags/v2.0.8', ambiguous).sha).toBe('tag-commit-sha')
  })
})
