import { getFilePreviewFileName } from '@renderer/utils/filePreview'

import type { EditToolInput } from '../shared/agentToolTypes'
import { AgentToolsType } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { ToolHeader } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { AgentFileDiffView } from './AgentFileDiffView'

function EditToolChildren({ input, output }: { input?: Partial<EditToolInput>; output?: unknown }) {
  const outputText = typeof output === 'string' ? output : undefined

  return (
    <AgentFileDiffView
      filePath={input?.file_path}
      hunks={[
        {
          oldString: input?.old_string,
          newString: input?.new_string
        }
      ]}>
      {outputText}
    </AgentFileDiffView>
  )
}

export function EditTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const decodedInput: Partial<EditToolInput> = {
    file_path: readToolStringArgument(input, 'file_path'),
    old_string: readToolStringArgument(input, 'old_string'),
    new_string: readToolStringArgument(input, 'new_string')
  }
  const filePath = decodedInput.file_path
  const filename = filePath ? getFilePreviewFileName(filePath) : undefined

  return {
    key: AgentToolsType.Edit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Edit}
        args={input}
        params={filePath ? <ClickableFilePath path={filePath} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <EditToolChildren input={decodedInput} output={output} />
  }
}
