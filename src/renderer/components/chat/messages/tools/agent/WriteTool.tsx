import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { ClickableFilePath } from './ClickableFilePath'
import { SkeletonValue, ToolHeader } from './GenericTools'
import { AgentToolsType, type WriteToolInput, type WriteToolOutput } from './types'

export function WriteTool({
  input,
  output,
  hasError
}: {
  input?: WriteToolInput
  output?: WriteToolOutput
  hasError?: boolean
}): ToolDisclosureItem {
  const filename = input?.file_path?.split('/').pop()
  const language = getLanguageByFilePath(input?.file_path ?? '')
  // A Write creates the file: keep the path inert until the call finishes
  // successfully (output present and no error). While streaming the file may
  // not exist yet, and a failed write never created it — so neither is clickable.
  const fileWritten = output !== undefined && !hasError

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
