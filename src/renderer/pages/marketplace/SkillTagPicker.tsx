import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Input } from '@cherrystudio/ui'

import { type SkillLibraryTagManager, TAG_COLORS } from './useSkillLibraryTags'

export function SkillTagPicker({
  manager,
  selected,
  onToggle,
  skillId,
  counts
}: {
  manager: SkillLibraryTagManager
  selected: readonly string[]
  onToggle: (id: string) => void
  skillId?: string
  counts?: Record<string, number>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(!counts)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2">
      {creating ? (
        <form
          className={counts ? 'order-last' : undefined}
          onSubmit={async (event) => {
            event.preventDefault()
            if (await manager.create(name, skillId)) {
              setName('')
              if (counts) setCreating(false)
            }
          }}>
          <Input
            aria-label={t('marketplace.new_tag')}
            placeholder={t('marketplace.new_tag')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation()
            }}
            maxLength={40}
            disabled={manager.saving}
            className="h-9 rounded-xl text-xs"
            autoFocus={Boolean(counts)}
          />
        </form>
      ) : null}
      <div className="max-h-60 overflow-y-auto">
        {manager.tags.map((tag) => (
          <div
            key={tag.id}
            className="group/tag flex items-center gap-1 rounded-lg px-2 text-xs hover:bg-accent"
            onMouseLeave={() => setDeleteTarget((current) => (current === tag.id ? null : current))}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDeleteTarget(null)
            }}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5">
              <Checkbox
                checked={selected.includes(tag.id)}
                onCheckedChange={() => {
                  setDeleteTarget(null)
                  onToggle(tag.id)
                }}
                disabled={manager.saving}
                aria-label={tag.name}
                className="size-3.5"
              />
              <span className={`size-1.5 shrink-0 rounded-full ${TAG_COLORS[tag.color % TAG_COLORS.length]}`} />
              <span className="truncate">{tag.name}</span>
              {counts ? <span className="ml-auto text-foreground-tertiary">{counts[tag.id] ?? 0}</span> : null}
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={manager.saving}
              aria-label={`${t(deleteTarget === tag.id ? 'common.delete_confirm' : 'common.delete')}: ${tag.name}`}
              title={t(deleteTarget === tag.id ? 'common.delete_confirm' : 'common.delete')}
              className={`size-5 shrink-0 rounded-md ${deleteTarget === tag.id ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive' : 'text-muted-foreground opacity-0 group-hover/tag:opacity-100 group-focus-within/tag:opacity-100 [@media(hover:none)]:opacity-100'}`}
              onClick={async () => {
                if (deleteTarget !== tag.id) {
                  setDeleteTarget(tag.id)
                  return
                }
                if (await manager.remove(tag.id)) setDeleteTarget(null)
              }}>
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
      {counts && !creating ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start px-2 text-xs text-muted-foreground"
          onClick={() => setCreating(true)}>
          <Plus className="size-3" />
          {t('library.create_menu.create', { type: t('library.config.basic.tags') })}
        </Button>
      ) : null}
    </div>
  )
}
