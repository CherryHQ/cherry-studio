import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import { SelectionAgentPicker, SelectionWorkspacePicker } from './selectionAgentPickers'

interface SelectionActionAskAgentModalProps {
  isModalOpen: boolean
  currentAction: SelectionActionItem | undefined
  onOk: (binding: Pick<SelectionActionItem, 'agentId' | 'agentWorkspace'>) => void
  onCancel: () => void
}

const SelectionActionAskAgentModal: FC<SelectionActionAskAgentModalProps> = ({
  isModalOpen,
  currentAction,
  onOk,
  onCancel
}) => {
  const { t } = useTranslation()
  const { agents } = useAgents()
  // null keeps the built-in assistant agent as a live default instead of pinning its id.
  const [agentId, setAgentId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<AgentSessionWorkspaceSource>({ type: AGENT_WORKSPACE_TYPE.SYSTEM })
  const builtinAssistantId =
    agents.find((agent) => agent.configuration?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT)?.id ?? null

  useEffect(() => {
    if (!isModalOpen) return
    setAgentId(currentAction?.agentId ?? null)
    setWorkspace(currentAction?.agentWorkspace ?? { type: AGENT_WORKSPACE_TYPE.SYSTEM })
  }, [isModalOpen, currentAction])

  return (
    <Dialog open={isModalOpen} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent aria-describedby={undefined} closeOnOverlayClick={false} className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle>{t('selection.settings.ask_agent_modal.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-foreground text-sm">{t('selection.settings.ask_agent_modal.agent')}</div>
            <SelectionAgentPicker value={agentId ?? builtinAssistantId} onChange={setAgentId} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-foreground text-sm">{t('selection.settings.ask_agent_modal.workspace')}</div>
            <SelectionWorkspacePicker value={workspace} onChange={setWorkspace} />
          </div>
          <div className="text-muted-foreground text-xs">{t('selection.settings.ask_agent_modal.hint')}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onOk({ agentId: agentId ?? undefined, agentWorkspace: workspace })}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SelectionActionAskAgentModal
