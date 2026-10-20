import { Bot, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { CreateAgentResult } from './createAgentResult'

export function CreateAgentToolInline({ result }: { result: CreateAgentResult }) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const openLabel = t('library.assistant_catalog.go_to_chat')

  return (
    <div className="my-1 flex min-h-12 max-w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success-subtle text-success-subtle-foreground">
        <Bot aria-hidden="true" size={16} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-success-subtle-foreground text-xs">
          <Check aria-hidden="true" size={13} strokeWidth={2} />
          <span>{t('common.create_success')}</span>
        </div>
        <div className="truncate font-medium text-foreground text-sm" title={result.name}>
          {result.name}
        </div>
      </div>
      {actions?.navigateToRoute ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label={`${openLabel}: ${result.name}`}
          onClick={() => void actions.navigateToRoute?.({ path: '/app/agents', query: { agentId: result.agentId } })}>
          {openLabel}
        </Button>
      ) : null}
    </div>
  )
}
