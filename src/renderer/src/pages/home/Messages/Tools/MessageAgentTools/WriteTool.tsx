import { File } from '@pierre/diffs/react'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { CollapseProps } from 'antd'
import { useMemo } from 'react'

import { ClickableFilePath } from './ClickableFilePath'
import { SkeletonValue, ToolHeader } from './GenericTools'
import { AgentToolsType, type WriteToolInput, type WriteToolOutput } from './types'

export function WriteTool({
  input
}: {
  input?: WriteToolInput
  output?: WriteToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { activeShikiTheme, isShikiThemeDark } = useCodeStyle()
  const filename = input?.file_path?.split('/').pop()
  const file = useMemo(
    () => ({
      name: input?.file_path ?? '',
      contents: input?.content ?? ''
    }),
    [input?.file_path, input?.content]
  )

  return {
    key: AgentToolsType.Write,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Write}
        params={
          <SkeletonValue
            value={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
            width="200px"
          />
        }
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: input ? (
      <File
        file={file}
        options={{
          disableFileHeader: true,
          overflow: 'wrap',
          theme: activeShikiTheme,
          themeType: isShikiThemeDark ? 'dark' : 'light'
        }}
      />
    ) : (
      <SkeletonValue value={null} width="100%" fallback={null} />
    )
  }
}
