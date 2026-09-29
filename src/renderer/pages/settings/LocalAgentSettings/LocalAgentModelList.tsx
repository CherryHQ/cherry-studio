import { Check, RefreshCw, Search, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelTag } from '@renderer/components/tags/Model'
import { cn } from '@renderer/utils/style'
import type { LocalAgentModelCatalog } from '@shared/ai/localAgent'

export function LocalAgentModelList({
  models,
  value,
  loaded,
  loading,
  disabled,
  loadDisabled,
  onLoad,
  onSelect
}: {
  models: LocalAgentModelCatalog['models']
  value?: string
  loaded: boolean
  loading: boolean
  disabled: boolean
  loadDisabled: boolean
  onLoad: () => Promise<void>
  onSelect: (value?: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const iconButtonClass =
    'size-6 shrink-0 rounded-md p-0 text-muted-foreground shadow-none hover:bg-accent/40 hover:text-foreground'
  const closeSearch = () => {
    setQuery('')
    setSearchOpen(false)
  }
  const options =
    value && !models.some((model) => model.id === value) ? [{ id: value, name: value }, ...models] : models
  const filtered = options.filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  const rowClass = (selected: boolean) =>
    cn(
      'group flex min-h-[42px] items-center gap-2.5 px-4 py-1 text-foreground leading-none',
      'h-auto w-full justify-start rounded-none font-normal hover:bg-accent/60 disabled:opacity-100',
      selected && 'bg-accent/70'
    )
  return (
    <section className="space-y-3 pt-3" aria-labelledby="local-agent-model-label">
      <div className="flex min-h-8 flex-wrap items-center gap-1">
        <h2 id="local-agent-model-label" className="text-sm font-semibold">
          {t('settings.models.list_title')}
        </h2>
        <span className="mr-1 ml-1 text-xs tabular-nums text-muted-foreground">{models.length}</span>
        {searchOpen || query ? (
          <InputGroup className="h-8 w-[min(38vw,220px)] min-w-36 rounded-[10px] border-border-subtle shadow-none">
            <InputGroupAddon className="pl-2.5">
              <Search className="lucide-custom size-3 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              placeholder={t('models.search.placeholder')}
              aria-label={t('models.search.placeholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onBlur={() => {
                if (!query) setSearchOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  closeSearch()
                }
              }}
            />
            {query && (
              <InputGroupAddon align="inline-end" className="pr-2">
                <InputGroupButton size="icon-xs" aria-label={t('common.clear')} onClick={closeSearch}>
                  <X className="size-3" />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        ) : (
          <Tooltip content={t('common.search')}>
            <Button
              variant="ghost"
              className={iconButtonClass}
              aria-label={t('common.search')}
              onClick={() => setSearchOpen(true)}>
              <Search className="lucide-custom size-3 text-muted-foreground" />
            </Button>
          </Tooltip>
        )}
        <Tooltip content={t('common.refresh')}>
          <Button
            variant="ghost"
            className={iconButtonClass}
            aria-label={t('common.refresh')}
            disabled={loading || disabled || loadDisabled}
            onClick={() => void onLoad()}>
            <RefreshCw className={cn('lucide-custom size-3 text-muted-foreground', loading && 'animate-spin')} />
          </Button>
        </Tooltip>
      </div>
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <Button
          variant="ghost"
          aria-pressed={!value}
          disabled={disabled}
          className={rowClass(!value)}
          onClick={() => void onSelect()}>
          <CliModelAvatar className="size-[26px] shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left text-sm">{t('local_agents.follow_cli')}</span>
          {!value && <Check className="size-4 shrink-0 text-primary" />}
        </Button>
      </div>
      {filtered.length > 0 ? (
        <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
          {filtered.map((model) => (
            <Button
              key={model.id}
              variant="ghost"
              aria-pressed={value === model.id}
              disabled={disabled}
              className={rowClass(value === model.id)}
              onClick={() => void onSelect(model.id)}>
              <ModelAvatar model={model} size={26} className="shrink-0 rounded-full" />
              <span className="min-w-0 flex-1 truncate text-left text-sm" title={model.name || model.id}>
                {model.name || model.id}
              </span>
              {/free/i.test(`${model.id} ${model.name}`) && (
                <ModelTag tag="free" size={9} showLabel={false} showTooltip className="[&_svg]:size-[9px]!" />
              )}
              {value === model.id && <Check className="size-4 shrink-0 text-primary" />}
            </Button>
          ))}
        </div>
      ) : (
        (loaded || query) && (
          <p className="rounded-lg border border-dashed border-border-subtle px-4 py-6 text-center text-xs text-muted-foreground">
            {t(query ? 'common.no_results' : 'local_agents.models_unavailable')}
          </p>
        )
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.model_hint')}</p>
    </section>
  )
}
