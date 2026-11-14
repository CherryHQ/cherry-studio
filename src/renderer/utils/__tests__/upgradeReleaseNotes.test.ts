import { describe, expect, it } from 'vitest'

import { collectUpgradeReleases } from '../upgradeReleaseNotes'

describe('upgrade release notes', () => {
  it('bounds the upgrade by semantic version and prefers history over stale event notes', () => {
    const entries = collectUpgradeReleases('2.1.8', { version: '2.1.10', releaseNotes: 'Target fallback' }, [
      { version: '2.1.8', releaseNotes: 'Already installed' },
      { version: '2.1.9', releaseNotes: 'Intermediate' },
      { version: '2.1.11', releaseNotes: 'Not this upgrade' },
      { version: '2.1.10', releaseNotes: 'Corrected target' }
    ])
    expect(entries).toEqual([
      { version: '2.1.10', releaseNotes: 'Corrected target' },
      { version: '2.1.9', releaseNotes: 'Intermediate' }
    ])
    expect(
      collectUpgradeReleases(
        '2.1.8',
        {
          version: '2.1.10',
          releaseNotes: [
            { version: '2.1.8', note: 'Old' },
            { version: 'invalid', note: 'Invalid' },
            { version: '2.1.9', note: 'Available' },
            { version: '2.1.11', note: 'Future' }
          ]
        },
        []
      )
    ).toEqual([{ version: '2.1.9', releaseNotes: 'Available' }])
  })

  it('keeps complete source documents and repeated entries across versions', () => {
    const markdown =
      '## Features\n- Shared feature\n  - Nested detail\n\n## Compatibility\nRead [guide][ref].\n\n[ref]: https://example.com'
    expect(
      collectUpgradeReleases('2.1.6', { version: '2.1.9', releaseNotes: markdown }, [
        { version: '2.1.8', releaseNotes: markdown },
        { version: '2.1.7', releaseNotes: '   ' }
      ])
    ).toEqual([
      { version: '2.1.9', releaseNotes: markdown },
      { version: '2.1.8', releaseNotes: markdown }
    ])
  })
})
