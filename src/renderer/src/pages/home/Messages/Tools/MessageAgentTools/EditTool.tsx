import { parseDiffFromFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { CollapseProps } from 'antd'
import { useMemo } from 'react'

import { ClickableFilePath } from './ClickableFilePath'
import { DiffStyleToggle, useDiffStyle } from './DiffStyleToggle'
import { ToolHeader } from './GenericTools'
import type { EditToolInput, EditToolOutput } from './types'
import { AgentToolsType } from './types'

function EditToolChildren({ input, output }: { input?: EditToolInput; output?: EditToolOutput }) {
  const { activeShikiTheme, isShikiThemeDark } = useCodeStyle()
  const { diffStyle, toggleDiffStyle } = useDiffStyle()

  const fileDiff = useMemo(() => {
    const fileName = input?.file_path ?? ''
    return parseDiffFromFile(
      { name: fileName, contents: input?.old_string ?? '' },
      { name: fileName, contents: input?.new_string ?? '' }
    )
  }, [input?.file_path, input?.old_string, input?.new_string])

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
      <FileDiff fileDiff={fileDiff} options={diffOptions} />
      {output}
    </div>
  )
}

export function EditTool({
  input,
  output
}: {
  input?: EditToolInput
  output?: EditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const filename = input?.file_path?.split('/').pop()

  return {
    key: AgentToolsType.Edit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Edit}
        params={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <EditToolChildren input={input} output={output} />
  }
}
