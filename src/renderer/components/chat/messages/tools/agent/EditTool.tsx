import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { AgentFileDiffView } from './AgentFileDiffView'
import { ClickableFilePath } from './ClickableFilePath'
import { ToolHeader } from './GenericTools'
import type { EditToolInput, EditToolOutput } from './types'
import { AgentToolsType } from './types'

function EditToolChildren({ input, output }: { input?: EditToolInput; output?: EditToolOutput }) {
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

export function EditTool({ input, output }: { input?: EditToolInput; output?: EditToolOutput }): ToolDisclosureItem {
  const filename = input?.file_path?.split('/').pop()

  return {
    key: AgentToolsType.Edit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Edit}
        args={input}
        params={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <EditToolChildren input={input} output={output} />
  }
}
