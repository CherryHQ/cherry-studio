import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'

import { useOptionalTerminalResources } from './TerminalResourcesProvider'

export function ShellExecutionActions({ toolCallId }: { toolCallId?: string }) {
  const { t } = useTranslation()
  const terminal = useOptionalTerminalResources()
  const resource = terminal?.resources.find((item) => item.toolCallId === toolCallId && toolCallId)
  if (!terminal || !resource) return null
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}>
      {resource.kind === 'pipe' &&
        resource.shell === 'bash' &&
        resource.retention.kind === 'turn' &&
        resource.process.kind === 'running' && (
          <Button size="sm" variant="ghost" onClick={() => void terminal.promote(resource)}>
            {t('terminal.run_background')}
          </Button>
        )}
      <Tooltip content={t('terminal.output')}>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('terminal.output')}
          onClick={() => terminal.show(resource.id, resource.shell)}>
          <ExternalLink className="size-3.5" />
        </Button>
      </Tooltip>
    </div>
  )
}
