import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/code-language'
import type { CollapseProps } from 'antd'

import { ClickableFilePath } from './ClickableFilePath'
import { SkeletonValue, ToolHeader } from './GenericTools'
import { AgentToolsType, type WriteToolInput, type WriteToolOutput } from './types'

export function WriteTool({
  input
}: {
  input?: WriteToolInput
  output?: WriteToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const filename = input?.file_path?.split('/').pop()
  const language = getLanguageByFilePath(input?.file_path ?? '')

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
      <CodeViewer
        value={input.content ?? ''}
        language={language}
        expanded={false}
        wrapped={false}
        maxHeight={240}
        options={{ lineNumbers: true }}
      />
    ) : (
      <SkeletonValue value={null} width="100%" fallback={null} />
    )
  }
}
