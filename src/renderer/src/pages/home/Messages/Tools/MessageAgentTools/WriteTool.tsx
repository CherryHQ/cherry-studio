import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/code-language'
import type { CollapseProps } from 'antd'
import { useMemo } from 'react'

import { SkeletonValue, ToolHeader } from './GenericTools'
import { AgentToolsType, type WriteToolInput, type WriteToolOutput } from './types'

export function WriteTool({
  input
}: {
  input?: WriteToolInput
  output?: WriteToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const language = useMemo(() => getLanguageByFilePath(input?.file_path ?? ''), [input?.file_path])

  return {
    key: 'tool',
    label: (
      <ToolHeader
        toolName={AgentToolsType.Write}
        params={<SkeletonValue value={input?.file_path} width="200px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: input?.content ? (
      <CodeViewer
        value={input.content}
        language={language}
        maxHeight={240}
        expanded={false}
        options={{ lineNumbers: true }}
      />
    ) : (
      <SkeletonValue value={null} width="100%" fallback={null} />
    )
  }
}
