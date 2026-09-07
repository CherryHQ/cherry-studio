import { Button } from '@cherrystudio/ui'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import type { HandoffPartData } from '@shared/data/types/uiParts'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function HandoffBlock({ data }: { data: HandoffPartData }) {
  const { t } = useTranslation()
  const targetNavigation = useConversationNavigation('agents')
  const sourceNavigation = useConversationNavigation('assistants')
  const targetName = data.targetAgentName ?? t('agent.session.group.unknown_agent')
  return (
    <div className="my-2 rounded-lg border border-border bg-muted/30 p-3 text-sm" data-handoff-id={data.handoffId}>
      <div className="flex items-center gap-2 font-medium">
        <ArrowRight className="size-4" aria-hidden />
        <span>{t('agent.session.handoff.block_title', { agent: targetName })}</span>
      </div>
      {data.goal ? <p className="mt-1 text-muted-foreground">{data.goal}</p> : null}
      <div className="mt-3 flex gap-2">
        {data.targetSessionId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => targetNavigation.openConversation(data.targetSessionId!, targetName)}>
            <ExternalLink className="mr-1 size-3.5" aria-hidden />
            {t('agent.session.handoff.open_agent')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => sourceNavigation.openConversation(data.source.id, data.source.name)}>
          {t('agent.session.handoff.open_source')}
        </Button>
      </div>
    </div>
  )
}
