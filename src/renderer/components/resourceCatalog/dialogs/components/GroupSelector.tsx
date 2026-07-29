import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { Group } from '@shared/data/types/group'
import { Plus, X } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  value: string | null
  onChange: (groupId: string | null) => void
  groups: Group[]
  isLoading?: boolean
  error?: Error
  disabled?: boolean
  portalContainer?: HTMLElement | null
  onCreateGroup?: () => void
}

const GROUP_SELECT_VALUE_PREFIX = 'group:'
const CREATE_GROUP_SELECT_VALUE = 'action:create-group'

function encodeGroupSelectValue(groupId: string) {
  return `${GROUP_SELECT_VALUE_PREFIX}${groupId}`
}

function decodeGroupSelectValue(value: string) {
  if (!value.startsWith(GROUP_SELECT_VALUE_PREFIX)) return null
  return value.slice(GROUP_SELECT_VALUE_PREFIX.length)
}

export const GroupSelector: FC<Props> = ({
  value,
  onChange,
  groups,
  isLoading,
  error,
  disabled,
  portalContainer,
  onCreateGroup
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const hasGroupOptions = groups.length > 0
  const isUnavailable = Boolean(isLoading || error)
  const canOpen = !disabled && !isUnavailable && (hasGroupOptions || Boolean(onCreateGroup))
  const selectOpen = canOpen && open
  const placeholder = isLoading
    ? t('common.loading')
    : error
      ? t('library.group_sync_failed')
      : t(
          hasGroupOptions || onCreateGroup
            ? 'library.config.basic.group_placeholder'
            : 'library.config.basic.group_empty'
        )

  useEffect(() => {
    if (!canOpen) setOpen(false)
  }, [canOpen])

  return (
    <div className="group/group-select relative flex w-full min-w-0 items-center">
      <Select
        disabled={!canOpen}
        open={selectOpen}
        value={!isUnavailable && value ? encodeGroupSelectValue(value) : ''}
        onOpenChange={(nextOpen) => setOpen(canOpen && nextOpen)}
        onValueChange={(selectedValue) => {
          if (selectedValue === CREATE_GROUP_SELECT_VALUE) {
            setOpen(false)
            onCreateGroup?.()
            return
          }
          const groupId = decodeGroupSelectValue(selectedValue)
          if (groupId !== null) onChange(groupId)
        }}>
        <SelectTrigger
          size="sm"
          className={cn(
            'w-full',
            value &&
              '[&_svg]:transition-opacity group-focus-within/group-select:[&_svg]:opacity-0 group-hover/group-select:[&_svg]:opacity-0'
          )}
          aria-label={t('library.config.basic.group')}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent portalContainer={portalContainer ?? undefined}>
          {groups.map((group) => (
            <SelectItem key={group.id} value={encodeGroupSelectValue(group.id)}>
              {group.name}
            </SelectItem>
          ))}
          {onCreateGroup && hasGroupOptions ? <SelectSeparator /> : null}
          {onCreateGroup ? (
            <SelectItem value={CREATE_GROUP_SELECT_VALUE}>
              <Plus />
              {t('common.group.create')}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {value && !disabled && !isUnavailable ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`${t('library.config.basic.group')} ${t('common.clear')}`}
          onClick={(event) => {
            event.stopPropagation()
            onChange(null)
          }}
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 flex size-5 min-h-0 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground/70 opacity-0 shadow-none transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 active:bg-muted group-focus-within/group-select:pointer-events-auto group-focus-within/group-select:opacity-100 group-hover/group-select:pointer-events-auto group-hover/group-select:opacity-100">
          <X size={12} />
        </Button>
      ) : null}
    </div>
  )
}
