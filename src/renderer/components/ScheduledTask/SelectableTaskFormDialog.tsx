import { AgentSelector } from '@renderer/components/resourceCatalog/selectors'

import { TaskFormDialog, type TaskFormDialogProps } from './TaskFormDialog'

export function SelectableTaskFormDialog(props: TaskFormDialogProps) {
  return <TaskFormDialog {...props} agentSelector={AgentSelector} />
}
