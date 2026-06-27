import { Button, FormField, FormItem, FormMessage } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AddCatalogPopover, type CatalogItem } from '@renderer/components/resource/dialogs/components/CatalogPicker'
import { FieldLabelWithHelp } from '@renderer/components/resource/dialogs/edit/EditDialogShared'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { Database, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ResourceCreateWizardFormValues } from '../types'

function KnowledgeBaseAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex size-6 items-center justify-center rounded-md bg-purple-500/15 text-purple-500', className)}>
      <Database size={14} strokeWidth={1.6} />
    </div>
  )
}

type KnowledgeStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
}

/**
 * Step 3 (assistant): attach knowledge bases. Mirrors the edit dialog's
 * knowledge sub-form — picker popover + linked list — bound to `knowledgeBaseIds`.
 */
export function KnowledgeStep({ form, portalContainer }: KnowledgeStepProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery('/knowledge-bases', { query: { limit: 100 } })
  const bases = useMemo(() => data?.items ?? [], [data])
  const value = form.watch('knowledgeBaseIds')

  const { catalog, linkedItems } = useMemo(() => {
    const byId = new Map(bases.map((base) => [base.id, base]))
    const linked = value.map(
      (id) =>
        byId.get(id) ?? {
          id,
          name: `${id.slice(0, 8)}${t('library.config.knowledge.invalid_suffix')}`,
          itemCount: 0
        }
    )
    const items: CatalogItem[] = bases.map((base) => ({
      id: base.id,
      name: base.name,
      description: t('library.config.knowledge.doc_count', { count: base.itemCount ?? 0 }),
      icon: <KnowledgeBaseAvatar />
    }))
    return { catalog: items, linkedItems: linked }
  }, [bases, t, value])

  const remove = (id: string) =>
    form.setValue(
      'knowledgeBaseIds',
      value.filter((itemId) => itemId !== id),
      { shouldDirty: true }
    )
  const add = (id: string) => form.setValue('knowledgeBaseIds', [...value, id], { shouldDirty: true })

  return (
    <FormField
      control={form.control}
      name="knowledgeBaseIds"
      render={() => (
        <FormItem>
          <FieldLabelWithHelp
            label={t('library.config.knowledge.linked')}
            help={t('library.config.knowledge.linked_hint')}
            formLabel={false}
          />
          {linkedItems.length === 0 ? (
            <div className="mt-2 flex flex-col items-center rounded-md border border-border/20 border-dashed p-6">
              <Database size={20} strokeWidth={1.2} className="mb-2 text-muted-foreground/80" />
              <p className="mb-1 text-muted-foreground/80 text-xs">{t('library.config.knowledge.empty_title')}</p>
              <p className="text-muted-foreground/80 text-xs">{t('library.config.knowledge.empty_desc')}</p>
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              {linkedItems.map((kb) => (
                <div
                  key={kb.id}
                  className="group flex items-center gap-3 rounded-md border border-border/35 bg-accent/15 px-3 py-2.5 transition-colors hover:border-border/50 hover:bg-accent/20">
                  <KnowledgeBaseAvatar className="size-8 text-base" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground text-sm">{kb.name}</div>
                    <div className="text-muted-foreground/80 text-xs">
                      {t('library.config.knowledge.doc_count', { count: kb.itemCount ?? 0 })}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(kb.id)}
                    aria-label={t('library.config.knowledge.remove_aria')}
                    className="flex h-6 min-h-0 w-6 items-center justify-center rounded-md font-normal text-muted-foreground/80 opacity-0 shadow-none transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:ring-0 group-hover:opacity-100">
                    <Trash2 size={10} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <AddCatalogPopover
            items={catalog}
            enabledIds={new Set(value)}
            onAdd={add}
            triggerLabel={t('library.config.knowledge.add')}
            searchPlaceholder={t('library.config.knowledge.search')}
            emptyLabel={t('library.config.knowledge.no_more')}
            disabled={isLoading}
            align="start"
            triggerPosition="start"
            triggerClassName="mt-2"
            portalContainer={portalContainer}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
