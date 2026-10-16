import { FileText, Loader2, Plus } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog } from '@cherrystudio/ui'
import { groupTranslations } from '@renderer/components/resourceCatalog/catalog'
import { ResourceCreateWizard } from '@renderer/components/resourceCatalog/dialogs/create'
import { useAgentMutations, useAssistantMutations } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import type { MarketplaceTemplate } from '@renderer/types/marketplace'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { buildCreateAgentCommand } from '@renderer/utils/resourceCatalog'

import {
  MarketplaceCard,
  MarketplaceCardAction,
  MarketplaceDetailBody,
  MarketplaceDetailFooter,
  MarketplaceDetailHeader,
  MarketplaceDetailProperties,
  MarketplaceDetailContent,
  MarketplaceGrid,
  MarketplaceLoadState
} from './MarketplaceComponents'
import { MARKETPLACE_CATEGORY_KEYS } from './marketplaceLabels'

export function MarketplaceTemplates({
  items,
  query,
  preview = false,
  loading,
  error,
  retry,
  active,
  category,
  categories,
  onCategoryChange
}: {
  items: MarketplaceTemplate[]
  query: string
  preview?: boolean
  loading: boolean
  error: unknown
  retry: () => void
  active: boolean
  category?: string
  categories?: string[]
  onCategoryChange?: (category: string) => void
}) {
  const { t, i18n } = useTranslation()
  const { createAgent, isCreatingAgent } = useAgentMutations()
  const { createAssistant } = useAssistantMutations()
  const [selected, setSelected] = useState<MarketplaceTemplate | null>(null)
  const [creating, setCreating] = useState<MarketplaceTemplate | null>(null)
  const [adding, setAdding] = useState<ReadonlySet<string>>(() => new Set())
  const busy = selected ? adding.has(selected.id) : false
  const pending = useRef(new Set<string>())
  useLayoutEffect(
    () => () => {
      setSelected(null)
      setCreating(null)
    },
    []
  )
  const trigger = useRef<HTMLButtonElement | null>(null)
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    const matched = items.filter(
      (item) =>
        (preview || !categories || !category || item.groups.includes(category)) &&
        [item.name, item.description, item.prompt, ...item.groups].join(' ').toLocaleLowerCase().includes(keyword)
    )
    return preview ? matched.slice(0, 6) : matched
  }, [items, query, preview, category, categories])
  const categoryLabel = (group: string) =>
    groupTranslations[group]?.[i18n.language] ??
    (MARKETPLACE_CATEGORY_KEYS[group] ? t(MARKETPLACE_CATEGORY_KEYS[group]) : group)
  const add = async (item: MarketplaceTemplate) => {
    if (item.kind === 'agent') {
      setSelected(null)
      setCreating(item)
      return
    }
    if (pending.current.has(item.id)) return
    pending.current.add(item.id)
    setAdding(new Set(pending.current))
    try {
      await createAssistant(item.createDto)
      toast.success(t('common.add_success'))
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('library.assistant_catalog.add_failed')))
    } finally {
      pending.current.delete(item.id)
      setAdding(new Set(pending.current))
    }
  }
  return (
    <div className={preview ? '' : 'flex h-full min-h-0 flex-col'}>
      {!preview && categories ? (
        <div className="mb-3 flex shrink-0 gap-1 overflow-x-auto pb-1" aria-label={t('marketplace.categories')}>
          {['', ...categories].map((group) => (
            <Button
              key={group}
              variant="ghost"
              size="sm"
              className={'shrink-0 rounded-full ' + (category === group ? 'bg-accent' : '')}
              aria-pressed={category === group}
              onClick={() => onCategoryChange?.(group)}>
              {group ? categoryLabel(group) : t('common.all')}
            </Button>
          ))}
        </div>
      ) : null}
      <MarketplaceLoadState loading={loading} error={error} empty={!filtered.length} retry={retry} />
      <MarketplaceGrid
        key={query + ':' + (category ?? '')}
        items={filtered}
        virtualized={!preview && Boolean(categories)}
        renderItem={(item) => (
          <MarketplaceCard
            name={item.name}
            description={item.description || item.prompt.replace(/\s+/g, ' ')}
            icon={
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-subtle text-2xl">
                {item.avatar}
              </span>
            }
            onOpen={(event) => {
              trigger.current = event.currentTarget
              setSelected(item)
            }}
            action={
              <MarketplaceCardAction
                title={t('common.add')}
                aria-busy={adding.has(item.id)}
                aria-label={t('common.add') + ': ' + item.name}
                disabled={adding.has(item.id)}
                onClick={(event) => {
                  trigger.current = event.currentTarget
                  void add(item)
                }}>
                {adding.has(item.id) ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </MarketplaceCardAction>
            }>
            {item.groups.length ? (
              <span className="mt-1 block truncate text-xs font-normal text-foreground-tertiary">
                {item.groups.map(categoryLabel).join(' · ')}
              </span>
            ) : null}
          </MarketplaceCard>
        )}
      />
      <Dialog
        open={Boolean(selected) && active}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null)
        }}>
        <MarketplaceDetailContent
          closeOnOverlayClick={!busy}
          onPointerDownOutside={(event) => busy && event.preventDefault()}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}>
          {selected ? (
            <>
              <MarketplaceDetailHeader
                curated
                name={selected.name}
                description={selected.description || selected.name}
                type={t(selected.kind === 'agent' ? 'marketplace.type.agent' : 'marketplace.type.assistant')}
                icon={
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border-subtle bg-background text-3xl shadow-sm">
                    {selected.avatar}
                  </span>
                }
              />
              <MarketplaceDetailBody>
                {selected.groups.length ? (
                  <MarketplaceDetailProperties
                    items={[
                      { label: t('marketplace.category'), value: selected.groups.map(categoryLabel).join(' · ') }
                    ]}
                  />
                ) : null}
                {selected.description ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {selected.description}
                  </p>
                ) : null}
                {selected.prompt ? (
                  <section className="space-y-2">
                    <h3 className="flex items-center gap-2 text-xs font-medium">
                      <FileText className="size-3.5 text-foreground-tertiary" />
                      {t(
                        selected.kind === 'agent'
                          ? 'marketplace.instructions'
                          : 'library.assistant_catalog.preview_prompt'
                      )}
                    </h3>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                      {selected.prompt}
                    </p>
                  </section>
                ) : null}
              </MarketplaceDetailBody>
              <MarketplaceDetailFooter>
                <span />
                <Button size="sm" disabled={busy} aria-busy={busy} onClick={() => void add(selected)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {t(busy ? 'common.loading' : 'common.add')}
                </Button>
              </MarketplaceDetailFooter>
            </>
          ) : null}
        </MarketplaceDetailContent>
      </Dialog>
      {creating ? (
        <ResourceCreateWizard
          kind="agent"
          open={active}
          isSubmitting={isCreatingAgent}
          initialValues={{
            name: creating.name,
            description: creating.description,
            avatar: creating.avatar,
            prompt: creating.prompt
          }}
          onOpenChange={(open) => {
            if (!open && !isCreatingAgent) {
              setCreating(null)
              trigger.current?.focus()
            }
          }}
          onSubmit={async (values) => {
            await createAgent(buildCreateAgentCommand(values))
            toast.success(t('common.add_success'))
            setCreating(null)
            trigger.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}
