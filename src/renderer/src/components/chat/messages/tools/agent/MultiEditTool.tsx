import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { AgentFileDiffView } from './AgentFileDiffView'
import { ClickableFilePath } from './ClickableFilePath'
import { ToolHeader } from './GenericTools'
import type { MultiEditToolInput, MultiEditToolOutput } from './types'
import { AgentToolsType } from './types'

function MultiEditToolChildren({ input }: { input?: MultiEditToolInput }) {
  const edits = Array.isArray(input?.edits) ? input.edits : []

  return (
    <AgentFileDiffView
      filePath={input?.file_path}
      hunks={edits.map((edit) => ({
        oldString: edit.old_string,
        newString: edit.new_string
      }))}
    />
  )
}

export function MultiEditTool({
  input
}: {
  input?: MultiEditToolInput
  output?: MultiEditToolOutput
}): ToolDisclosureItem {
  const filename = input?.file_path?.split('/').pop()

  return {
    key: AgentToolsType.MultiEdit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.MultiEdit}
        params={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <MultiEditToolChildren input={input} />
  }
}
