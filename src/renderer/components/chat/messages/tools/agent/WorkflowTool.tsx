import { useTranslation } from 'react-i18next'

import { AgentToolsType, type ToolRendererProps } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'

export function WorkflowTool({ input, output }: ToolRendererProps<typeof AgentToolsType.Workflow>): ToolDisclosureItem {
  const { t } = useTranslation()
  const result = output && typeof output !== 'string' ? output : undefined
  // The tool always launches in the background and returns a receipt, so the run's identity comes
  // from the result: `workflowName` mirrors the script's `meta.name`. `input.description` / `title`
  // are documented as ignored by the SDK, so they are deliberately not used as a label.
  const name = result?.workflowName ?? input?.name
  const target = name ?? (result?.taskId ? t('message.tools.activity.taskId', { id: result.taskId }) : undefined)

  return {
    key: AgentToolsType.Workflow,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Workflow}
        args={input}
        params={<SkeletonValue value={target} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: result?.summary ? (
      <div className="rounded-md bg-muted/30 p-2 text-foreground text-xs">{result.summary}</div>
    ) : undefined
  }
}
