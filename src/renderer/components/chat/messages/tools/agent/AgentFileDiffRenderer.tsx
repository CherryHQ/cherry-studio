import type { FileDiffOptions } from '@pierre/diffs'
import { parseDiffFromFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useMemo } from 'react'

import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import '@renderer/utils/pierreCodeTheme'

import type { AgentFileDiffHunk } from './AgentFileDiffView'
import { DiffStyleToggle, useDiffStyle } from './DiffStyleToggle'

function AgentFileDiffHunkView({
  filePath,
  hunk,
  options
}: {
  filePath: string
  hunk: AgentFileDiffHunk
  options: FileDiffOptions<undefined, undefined>
}) {
  const fileDiff = useMemo(
    () =>
      parseDiffFromFile(
        { name: filePath, contents: hunk.oldString ?? '' },
        { name: filePath, contents: hunk.newString ?? '' }
      ),
    [filePath, hunk.oldString, hunk.newString]
  )

  return <FileDiff fileDiff={fileDiff} options={options} />
}

export default function AgentFileDiffRenderer({ filePath, hunks }: { filePath?: string; hunks: AgentFileDiffHunk[] }) {
  const { activeCodeTheme, isCodeThemeDark } = useCodeStyle()
  const { diffStyle, toggleDiffStyle } = useDiffStyle()
  const themeType: 'dark' | 'light' = isCodeThemeDark ? 'dark' : 'light'
  const diffOptions = useMemo(
    () => ({
      disableFileHeader: true,
      preferredHighlighter: 'highlights' as const,
      diffStyle,
      overflow: 'wrap' as const,
      theme: activeCodeTheme,
      themeType
    }),
    [activeCodeTheme, themeType, diffStyle]
  )

  return (
    <>
      <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyle} />
      {hunks.map((hunk, index) => (
        <AgentFileDiffHunkView key={index} filePath={filePath ?? ''} hunk={hunk} options={diffOptions} />
      ))}
    </>
  )
}
