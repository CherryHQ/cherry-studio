import { getFilePreviewFileName } from '@renderer/utils/filePreview'

import { AgentToolsType } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { ToolHeader } from '../shared/GenericTools'
import { isToolArgumentObject, readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { AgentFileDiffView } from './AgentFileDiffView'

export function MultiEditTool({ input }: ToolDisplayProps): ToolDisclosureItem {
  const filePath = readToolStringArgument(input, 'file_path')
  const filename = filePath ? getFilePreviewFileName(filePath) : undefined
  const rawEdits = isToolArgumentObject(input) ? input.edits : undefined
  const hunks = Array.isArray(rawEdits)
    ? rawEdits.map((edit) => ({
        oldString: readToolStringArgument(edit, 'old_string'),
        newString: readToolStringArgument(edit, 'new_string')
      }))
    : []

  return {
    key: AgentToolsType.MultiEdit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.MultiEdit}
        args={input}
        params={filePath ? <ClickableFilePath path={filePath} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <AgentFileDiffView filePath={filePath} hunks={hunks} />
  }
}
