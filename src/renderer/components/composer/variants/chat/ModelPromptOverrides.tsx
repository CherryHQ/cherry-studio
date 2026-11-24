import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelPromptPair } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'

/** Model-id keyed controls: removing or reordering a selection cannot move its prompt to a sibling. */
export function ModelPromptOverrides({
  models,
  value,
  onChange,
  disabled = false
}: {
  models: Model[]
  value: ModelPromptPair[]
  onChange: (pairs: ModelPromptPair[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <details className="mx-3 mb-2 rounded-md border border-border bg-background p-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">{t('chat.model_prompt.title')}</summary>
      <p className="my-2 text-xs text-muted-foreground">{t('chat.model_prompt.hint')}</p>
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {models.map((model, index) => {
          const pair = value.find((entry) => entry.modelId === model.id)
          const fieldId = `${id}-${index}`
          return (
            <fieldset key={model.id} className="min-w-0 space-y-1" disabled={disabled}>
              <legend className="max-w-full truncate font-medium" title={`${model.name} (${model.providerId})`}>
                {model.name} <span className="text-xs text-muted-foreground">({model.providerId})</span>
              </legend>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={pair !== undefined}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [
                            ...value.filter((entry) => entry.modelId !== model.id),
                            { modelId: model.id, systemPrompt: '' }
                          ]
                        : value.filter((entry) => entry.modelId !== model.id)
                    )
                  }
                />
                {t('chat.model_prompt.override')}
              </label>
              {pair ? (
                <textarea
                  id={fieldId}
                  aria-label={`${model.name}: ${t('chat.model_prompt.override')}`}
                  rows={3}
                  maxLength={100_000}
                  className="w-full resize-y rounded border border-input bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={pair.systemPrompt}
                  onChange={(event) =>
                    onChange(
                      value.map((entry) =>
                        entry.modelId === model.id ? { ...entry, systemPrompt: event.target.value } : entry
                      )
                    )
                  }
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t('chat.model_prompt.inherit')}</p>
              )}
            </fieldset>
          )
        })}
      </div>
    </details>
  )
}
