import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { readDeferredHistoryPart } from '@renderer/utils/message/deferredHistoryPart'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { CherryDataPartTypes } from '@shared/data/types/uiParts'

const logger = loggerService.withContext('DeferredHistoryPartBlock')

export default function DeferredHistoryPartBlock({
  part,
  renderPart
}: {
  part: CherryDataPartTypes['deferred-history-part']
  renderPart: (part: CherryMessagePart) => ReactNode
}) {
  const { t } = useTranslation()
  const contentId = useId()
  const [content, setContent] = useState<CherryMessagePart>()
  const expanded = !!content
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function toggle() {
    if (content) {
      setContent(undefined)
      return
    }
    setLoading(true)
    setFailed(false)
    try {
      setContent(await readDeferredHistoryPart(part))
    } catch (error) {
      logger.error('Failed to read deferred session history part', error as Error, { partId: part.partId })
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const label = t(expanded ? 'common.collapse' : failed ? 'common.retry' : 'common.expand')
  const expandedContent =
    content?.type === 'text' || content?.type === 'reasoning' ? (
      <Textarea.Input
        aria-label={part.partType}
        className="h-64 field-sizing-fixed font-mono"
        readOnly
        value={content.text}
        wrap="off"
      />
    ) : (
      content &&
      (renderPart(content) ?? <pre className="max-h-64 overflow-auto">{JSON.stringify(content, null, 2)}</pre>)
    )

  return (
    <div className="min-w-0 space-y-1 rounded-md border p-2">
      <div id={contentId}>
        {expanded ? (
          expandedContent
        ) : (
          <p className="line-clamp-4 whitespace-pre-wrap break-all text-muted-foreground">
            {part.excerpt || part.partType}
          </p>
        )}
      </div>
      {failed && <p role="alert">{t('message.error.unknown')}</p>}
      <Button
        aria-controls={contentId}
        aria-expanded={expanded}
        disabled={loading}
        onClick={toggle}
        size="sm"
        variant="ghost">
        {loading ? t('common.loading') : label}
      </Button>
    </div>
  )
}
