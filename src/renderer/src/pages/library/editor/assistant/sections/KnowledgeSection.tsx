import {
  Button,
  FieldLabel,
  Input,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar
} from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { Database, Plus, Search, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  value: string[]
  onChange: (ids: string[]) => void
}

/**
 * Knowledge base picker — writes the top-level `knowledgeBaseIds` array on the
 * assistant.
 */
const KnowledgeSection: FC<Props> = ({ value, onChange }) => {
  const { t, i18n } = useTranslation()
  const { data, isLoading } = useQuery('/knowledge-bases', { query: { limit: 100 } })
  const bases = useMemo(() => data?.items ?? [], [data])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')

  const { linkedItems, unlinkedItems } = useMemo(() => {
    const byId = new Map(bases.map((b) => [b.id, b]))
    const linked = value.map(
      (id) =>
        byId.get(id) ?? {
          id,
          name: `${id.slice(0, 8)}${t('library.config.knowledge.invalid_suffix')}`,
          documentCount: 0
        }
    )
    const keyword = search.trim().toLowerCase()
    const unlinked = bases.filter((b) => !value.includes(b.id) && (!keyword || b.name.toLowerCase().includes(keyword)))
    return { linkedItems: linked, unlinkedItems: unlinked }
  }, [bases, i18n.resolvedLanguage, search, t, value])

  const remove = (id: string) => onChange(value.filter((x) => x !== id))
  const add = (id: string) => {
    onChange([...value, id])
    setPickerOpen(false)
    setSearch('')
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.knowledge.title')}</h3>
        <p className="text-muted-foreground/60 text-xs">{t('library.config.knowledge.desc')}</p>
      </div>

      <div>
        <FieldLabel className="mb-2 block font-normal text-muted-foreground/80 text-sm">
          {t('library.config.knowledge.linked')}
        </FieldLabel>
        {linkedItems.length === 0 ? (
          <div className="flex flex-col items-center rounded-xs border border-border/20 border-dashed p-6">
            <Database size={20} strokeWidth={1.2} className="mb-2 text-muted-foreground/40" />
            <p className="mb-1 text-muted-foreground/60 text-xs">{t('library.config.knowledge.empty_title')}</p>
            <p className="text-muted-foreground/50 text-xs">{t('library.config.knowledge.empty_desc')}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {linkedItems.map((kb) => (
              <div
                key={kb.id}
                className="group flex items-center gap-3 rounded-xs border border-border/35 bg-accent/15 px-3 py-2.5 transition-colors hover:border-border/50 hover:bg-accent/20">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xs bg-accent/50">
                  <Database size={14} strokeWidth={1.4} className="text-foreground/70" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-foreground text-sm">{kb.name}</div>
                  <div className="text-muted-foreground/50 text-xs">
                    {t('library.config.knowledge.doc_count', { count: kb.documentCount ?? 0 })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(kb.id)}
                  aria-label={t('library.config.knowledge.remove_aria')}
                  className="flex h-6 min-h-0 w-6 items-center justify-center rounded-3xs font-normal text-muted-foreground/50 opacity-0 shadow-none transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:ring-0 group-hover:opacity-100">
                  <Trash2 size={10} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              disabled={isLoading}
              className="mt-2 flex h-auto min-h-0 items-center gap-1 rounded-2xs border border-border/20 px-2.5 py-1.5 font-normal text-muted-foreground/60 text-xs shadow-none transition-colors hover:border-border/40 hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:opacity-50">
              <Plus size={10} /> {t('library.config.knowledge.add')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={4} className="w-60 rounded-xs p-2">
            <div className="relative mb-2">
              <Search
                size={10}
                className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-muted-foreground/50"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('library.config.knowledge.search')}
                className="h-auto rounded-2xs border border-border/20 bg-accent/15 py-1.5 pr-2 pl-6 text-xs shadow-none transition-all focus-visible:border-border/40 focus-visible:ring-0"
              />
            </div>
            {unlinkedItems.length === 0 ? (
              <p className="px-2 py-3 text-center text-muted-foreground/50 text-xs">
                {t('library.config.knowledge.no_more')}
              </p>
            ) : (
              <Scrollbar className="max-h-60">
                <MenuList>
                  {unlinkedItems.map((kb) => (
                    <MenuItem
                      key={kb.id}
                      size="sm"
                      variant="ghost"
                      className="rounded-2xs"
                      icon={<Database size={12} strokeWidth={1.4} />}
                      label={kb.name}
                      description={t('library.config.knowledge.doc_count', { count: kb.documentCount ?? 0 })}
                      onClick={() => add(kb.id)}
                    />
                  ))}
                </MenuList>
              </Scrollbar>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export default KnowledgeSection
