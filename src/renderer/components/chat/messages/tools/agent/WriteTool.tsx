import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { ClickableFilePath } from './ClickableFilePath'
import { SkeletonValue, ToolHeader } from './GenericTools'
import { AgentToolsType, type WriteToolInput, type WriteToolOutput } from './types'

export function WriteTool({ input, output }: { input?: WriteToolInput; output?: WriteToolOutput }): ToolDisclosureItem {
  const filename = input?.file_path?.split('/').pop()
  const language = getLanguageByFilePath(input?.file_path ?? '')
  // A Write creates the file: until the tool call completes (output present),
  // the file may not exist on disk yet, so the path must not be clickable.
  const fileWritten = output !== undefined

  return {
    key: AgentToolsType.Write,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Write}
        args={input}
        params={
          <SkeletonValue
            value={
              input?.file_path ? (
                <ClickableFilePath path={input.file_path} displayName={filename} interactive={fileWritten} />
              ) : undefined
            }
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
