import type { FileDiffOptions } from '@pierre/diffs'
import { parseDiffFromFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { CollapseProps } from 'antd'
import { useMemo } from 'react'

import { ClickableFilePath } from './ClickableFilePath'
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

export function MultiEditTool({
  input
}: {
  input?: MultiEditToolInput
  output?: MultiEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { activeShikiTheme, isShikiThemeDark } = useCodeStyle()
  const filename = input?.file_path?.split('/').pop()
  const edits = Array.isArray(input?.edits) ? input.edits : []

  const diffOptions = useMemo(
    () => ({
      disableFileHeader: true,
      diffStyle: 'unified' as const,
      overflow: 'wrap' as const,
      theme: activeShikiTheme,
      themeType: (isShikiThemeDark ? 'dark' : 'light') as 'dark' | 'light'
    }),
    [activeShikiTheme, isShikiThemeDark]
  )

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
    children: (
      <div>
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
}
