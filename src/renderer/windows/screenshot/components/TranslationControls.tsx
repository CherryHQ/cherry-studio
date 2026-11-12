import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { isNonChatModel } from '@shared/utils/model'

import type { ScreenshotTranslation } from '../hooks/useScreenshotTranslation'

export function TranslationControls({
  translation,
  disabled,
  disabledReason
}: {
  translation: ScreenshotTranslation
  disabled: boolean
  disabledReason?: string
}) {
  const { t } = useTranslation()
  const { workState, counts, errorMessage } = translation
  const statusKey = errorMessage
    ? errorMessage === 'ocr_unavailable'
      ? 'screenshot.ocr.unavailable'
      : `screenshot.translate.${errorMessage}`
    : workState === 'idle'
      ? translation.modelStatus === 'missing'
        ? 'screenshot.translate.model_required'
        : null
      : `screenshot.translate.${
          {
            preparing: 'preparing',
            translating: 'running',
            done: 'complete',
            'partial-failure': 'partial_failure',
            empty: 'no_eligible_text',
            error: 'configuration_failed'
          }[workState]
        }`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('screenshot.action.translate')}
          aria-pressed={workState !== 'idle'}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={() => {
            if (workState === 'idle') translation.start()
          }}>
          <Languages className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={16}
        aria-label={t('screenshot.action.translate')}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('translate.target_language')}</span>
          <LanguageSelect
            value={translation.targetLangCode}
            onChange={(code) => void translation.setTargetLanguage(code)}
          />
        </label>
        <ModelSelector
          multiple={false}
          selectionType="id"
          value={translation.modelId ?? undefined}
          onSelect={(id) => void translation.selectModel(id)}
          filter={(model) => !isNonChatModel(model)}
          trigger={
            <Button variant="outline" className="w-full" aria-label={t('translate.settings.model_placeholder')}>
              {t('translate.settings.model_placeholder')}
            </Button>
          }
        />
        <div role="status" className="space-y-1 text-sm text-muted-foreground">
          {statusKey && (
            <p>
              {t(statusKey, {
                completed: counts.translated + counts.failed,
                total: counts.total - counts.skipped,
                failed: counts.failed,
                succeeded: counts.translated
              })}
            </p>
          )}
          {counts.skipped > 0 && <p>{t('screenshot.translate.skipped_summary', { skipped: counts.skipped })}</p>}
          {translation.modelPersistError && <p>{t('screenshot.translate.model_not_remembered')}</p>}
        </div>
        <div className="flex gap-1">
          {(
            [
              ['original', 'screenshot.translate.original'],
              ['translated', 'screenshot.translate.translated']
            ] as const
          ).map(([view, labelKey]) => (
            <Button
              key={view}
              variant="ghost"
              size="sm"
              aria-pressed={translation.view === view}
              onClick={() => translation.setView(view)}>
              {t(labelKey)}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={translation.clear}>
            {t('screenshot.translate.clear')}
          </Button>
        </div>
        {counts.failed > 0 && (
          <ul className="max-h-48 space-y-2 overflow-y-auto">
            {translation.blocks
              .filter((block) => block.status === 'failed')
              .map((block) => {
                const reasonKey = `screenshot.translate.reason.${block.reason ?? 'failed'}`
                return (
                  <li key={block.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate" title={block.sourceText}>
                        {block.sourceText}
                      </p>
                      <p className="text-muted-foreground">{t(reasonKey)}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => translation.retry(block.id)}>
                      {t('screenshot.translate.retry')}
                    </Button>
                  </li>
                )
              })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
