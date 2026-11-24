import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { getFilePreviewFileName } from '@renderer/utils/filePreview'

import { AgentToolsType } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'

export function WriteTool({ input, output, hasError }: ToolDisplayProps): ToolDisclosureItem {
  const filePath = readToolStringArgument(input, 'file_path')
  const content = readToolStringArgument(input, 'content')
  const filename = filePath ? getFilePreviewFileName(filePath) : undefined
  const language = getLanguageByFilePath(filePath ?? '')
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
              filePath ? (
                <ClickableFilePath path={filePath} displayName={filename} interactive={fileWritten} />
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
        value={content ?? ''}
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
