import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button } from '@cherrystudio/ui'
import { AgentSelector } from '@renderer/components/resourceCatalog/selectors'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

export function WorkspaceLanding({
  workspace,
  selectingAgent,
  onAgentChange,
  toolbarLeading
}: {
  workspace: AgentWorkspaceEntity
  selectingAgent: boolean
  onAgentChange: (agentId: string | null) => void | Promise<void>
  toolbarLeading?: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center p-2">{toolbarLeading}</div>
      <section aria-label={workspace.name} className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <Badge variant="outline">{t('common.selected')}</Badge>
        <h1 className="text-lg font-medium text-foreground">{workspace.name}</h1>
        <p className="max-w-full break-all text-sm text-muted-foreground">{workspace.path}</p>
        <AgentSelector
          value={null}
          onChange={(agentId) => void onAgentChange(agentId)}
          trigger={<Button disabled={selectingAgent}>{t('agent.session.new')}</Button>}
        />
      </section>
    </div>
  )
}
