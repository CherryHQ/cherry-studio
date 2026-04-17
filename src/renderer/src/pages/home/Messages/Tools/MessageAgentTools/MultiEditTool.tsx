import type { FileDiffOptions } from '@pierre/diffs'
import { parseDiffFromFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { CollapseProps } from 'antd'
import { useMemo } from 'react'

import { ClickableFilePath } from './ClickableFilePath'
import { DiffStyleToggle, useDiffStyle } from './DiffStyleToggle'
import { ToolHeader } from './GenericTools'
import type { MultiEditToolInput, MultiEditToolOutput } from './types'
import { AgentToolsType } from './types'

function EditHunk({
  filePath,
  oldString,
  newString,
  options
}: {
  filePath: string
  oldString: string
  newString: string
  options: FileDiffOptions<undefined>
}) {
  const fileDiff = useMemo(
    () => parseDiffFromFile({ name: filePath, contents: oldString }, { name: filePath, contents: newString }),
    [filePath, oldString, newString]
  )

  return <FileDiff fileDiff={fileDiff} options={options} />
}

function MultiEditToolChildren({ input }: { input?: MultiEditToolInput }) {
  const { activeShikiTheme, isShikiThemeDark } = useCodeStyle()
  const { diffStyle, toggleDiffStyle } = useDiffStyle()
  const edits = Array.isArray(input?.edits) ? input.edits : []

  const themeType: 'dark' | 'light' = isShikiThemeDark ? 'dark' : 'light'
  const diffOptions = useMemo(
    () => ({
      disableFileHeader: true,
      diffStyle,
      overflow: 'wrap' as const,
      theme: activeShikiTheme,
      themeType
    }),
    [activeShikiTheme, themeType, diffStyle]
  )

  return (
    <div className="relative">
      <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyle} />
      {edits.map((edit, index) => (
        <EditHunk
          key={index}
          filePath={input?.file_path ?? ''}
          oldString={edit.old_string ?? ''}
          newString={edit.new_string ?? ''}
          options={diffOptions}
        />
      ))}
    </div>
  )
}

export function MultiEditTool({
  input
}: {
  input?: MultiEditToolInput
  output?: MultiEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const filename = input?.file_path?.split('/').pop()

  return {
    key: AgentToolsType.MultiEdit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.MultiEdit}
        params={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <MultiEditToolChildren input={input} />
  }
}
