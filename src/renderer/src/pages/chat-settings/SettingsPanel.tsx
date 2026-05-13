import { PageSidePanel, Skeleton } from '@cherrystudio/ui'
import { useAssistant, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import ChatPreferencesTab from '@renderer/pages/agents/ChatPreferencesTab'
import { AssistantSettingsTab } from '@renderer/pages/home/components/ChatNavBar/Tools/SettingsTab'
import { SlidersHorizontal } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

type SettingsPanelMode = 'assistant' | 'agent'

interface Props {
  open: boolean
  onClose: () => void
  mode: SettingsPanelMode
  assistantId?: string
}

const SettingsPanel: FC<Props> = ({ open, onClose, mode, assistantId }) => {
  const { t } = useTranslation()

  const header = (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground leading-none">
      <SlidersHorizontal size={11} className="shrink-0 text-muted-foreground/60" />
      <span className="truncate">{t('settings.parameter_settings')}</span>
    </span>
  )

  return (
    <PageSidePanel
      open={open}
      onClose={onClose}
      header={header}
      closeLabel={t('common.close')}
      backdropClassName="hidden"
      contentClassName="top-[calc(var(--navbar-height)+0.5rem)] right-2 bottom-2 w-[340px] max-w-[calc(100%-1rem)] rounded-2xl border-border/30 bg-popover"
      headerClassName="h-[38px] border-border/30 px-3"
      bodyClassName="space-y-0 p-0 text-xs"
      closeButtonClassName="h-6 w-6 rounded-md p-0">
      {mode === 'assistant' ? <AssistantSettingsPanelBody assistantId={assistantId} /> : <ChatPreferencesTab />}
    </PageSidePanel>
  )
}

const AssistantSettingsPanelBody: FC<{ assistantId?: string }> = ({ assistantId }) => {
  const { assistant, isLoading } = useAssistant(assistantId)
  const { assistant: defaultAssistant } = useDefaultAssistant()

  if (assistant) {
    return <AssistantSettingsTab assistant={assistant} />
  }

  if (!assistantId) {
    return <AssistantSettingsTab assistant={defaultAssistant} />
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return <AssistantSettingsTab assistant={defaultAssistant} />
}

export default SettingsPanel
