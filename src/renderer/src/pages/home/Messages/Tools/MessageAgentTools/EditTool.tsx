import { parseDiffFromFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { CollapseProps } from 'antd'
import { useMemo } from 'react'

import { ClickableFilePath } from './ClickableFilePath'
import { ToolHeader } from './GenericTools'
import type { EditToolInput, EditToolOutput } from './types'
import { AgentToolsType } from './types'

export function EditTool({
  input,
  output
}: {
  input?: EditToolInput
  output?: EditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { activeShikiTheme, isShikiThemeDark } = useCodeStyle()
  const filename = input?.file_path?.split('/').pop()
  const fileDiff = useMemo(() => {
    const fileName = input?.file_path ?? ''
    return parseDiffFromFile(
      { name: fileName, contents: input?.old_string ?? '' },
      { name: fileName, contents: input?.new_string ?? '' }
    )
  }, [input?.file_path, input?.old_string, input?.new_string])

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
    children: (
      <>
        <FileDiff
          fileDiff={fileDiff}
          options={{
            disableFileHeader: true,
            diffStyle: 'unified',
            overflow: 'wrap',
            theme: activeShikiTheme,
            themeType: isShikiThemeDark ? 'dark' : 'light'
          }}
        />
        {output}
      </>
    )
  }
}
