import { describe, expect, it } from 'vitest'

import { getArtifactPaneSelectionPath, resolveArtifactPaneFileSelection } from '../artifactPanePath'

describe('artifactPanePath', () => {
  it('repairs a Windows drive-root artifact path missing its slash before previewing', () => {
    const selection = resolveArtifactPaneFileSelection(
      'D:/cherry/Data/Agents/system/session',
      'D:cherry/Data/Agents/system/session/新认识论.md'
    )

    expect(selection && getArtifactPaneSelectionPath(selection)).toBe(
      'D:\\cherry\\Data\\Agents\\system\\session\\新认识论.md'
    )
  })

  it('keeps colon-prefixed artifact paths relative in a POSIX workspace', () => {
    const selection = resolveArtifactPaneFileSelection('/tmp/workspace', 'D:notes/report.md')

    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('/tmp/workspace/D:notes/report.md')
  })

  it('rejects an ambiguous Windows drive-relative path instead of redirecting it to the drive root', () => {
    expect(resolveArtifactPaneFileSelection('D:/work', 'D:notes/report.md')).toBeNull()
  })
})
