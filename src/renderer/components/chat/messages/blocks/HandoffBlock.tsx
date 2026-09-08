import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button } from '@cherrystudio/ui'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import type { HandoffPartData } from '@shared/data/types/uiParts'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function HandoffBlock({
  data,
  context,
  conversationId
}: {
  data: HandoffPartData
  context?: string
  conversationId: string
}) {
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
      {context ? (
        <Accordion type="single" collapsible>
          <AccordionItem value="context" className="border-0">
            <AccordionTrigger className="py-2 font-normal">{t('agent.session.handoff.context')}</AccordionTrigger>
            <AccordionContent>
              <div className="whitespace-pre-wrap break-words text-foreground">{context}</div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
      <div className="mt-3 flex gap-2">
        {data.targetSessionId && data.targetSessionId !== conversationId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => targetNavigation.openConversation(data.targetSessionId!, targetName)}>
            <ExternalLink className="mr-1 size-3.5" aria-hidden />
            {t('agent.session.handoff.open_agent')}
          </Button>
        ) : null}
        {data.source.id !== conversationId ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => sourceNavigation.openConversation(data.source.id, data.source.name)}>
            {t('agent.session.handoff.open_source')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
