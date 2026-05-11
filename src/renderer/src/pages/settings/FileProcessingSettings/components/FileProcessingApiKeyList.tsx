import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@cherrystudio/ui'
import { EditIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import { cn } from '@renderer/utils/style'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { Check, Copy, Minus, Plus, X } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type FileProcessingApiKeyListItem as ApiKeyListItem,
  useFileProcessingApiKeyList
} from '../hooks/useFileProcessingApiKeyList'
import type { ApiKeyValidity } from '../utils/fileProcessingApiKeys'

function maskFileProcessingApiKey(key: string): string {
  if (!key) {
    return ''
  }

  if (key.length > 24) {
    return `${key.slice(0, 8)}****${key.slice(-8)}`
  }

  if (key.length > 16) {
    return `${key.slice(0, 4)}****${key.slice(-4)}`
  }

  if (key.length > 8) {
    return `${key.slice(0, 2)}****${key.slice(-2)}`
  }

  return key
}

interface FileProcessingApiKeyListProps {
  processorId: FileProcessorId
  apiKeys: string[]
  onSetApiKeys: (processorId: FileProcessorId, apiKeys: string[]) => Promise<void>
}

interface FileProcessingApiKeyItemProps {
  item: ApiKeyListItem
  onUpdate: (newKey: string) => ApiKeyValidity
  onRemove: () => void
}

const FileProcessingApiKeyItem: FC<FileProcessingApiKeyItemProps> = ({ item, onUpdate, onRemove }) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(item.isNew || !item.key.trim())
  const [editValue, setEditValue] = useState(item.key)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasUnsavedChanges = editValue.trim() !== item.key.trim()

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(item.key)
    setIsEditing(item.isNew || !item.key.trim())
  }, [item.isNew, item.key])

  const handleSave = () => {
    const result = onUpdate(editValue)
    if (!result.isValid) {
      window.toast.warning(result.error)
      return
    }

    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    if (item.isNew || !item.key.trim()) {
      onRemove()
      return
    }

    setEditValue(item.key)
    setIsEditing(false)
  }

  const handleCopy = () => {
    navigator.clipboard
      .writeText(item.key)
      .then(() => window.toast.success(t('common.copied')))
      .catch(() => window.toast.error(t('common.copy_failed')))
  }

  const handleRemove = async () => {
    const confirmed = await window.modal.confirm({
      title: t('common.delete_confirm'),
      centered: true,
      okText: t('common.confirm'),
      cancelText: t('common.cancel')
    })

    if (confirmed) {
      onRemove()
    }
  }

  return (
    <div className="flex min-h-10 items-center justify-between gap-2 border-border/40 border-b px-3 py-2 last:border-b-0">
      {isEditing ? (
        <>
          <Input
            ref={inputRef}
            type="password"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleSave()
              }
            }}
            placeholder={t('settings.provider.api.key.new_key.placeholder')}
            className="h-8 min-w-0 flex-1 rounded-lg border-border/30 bg-foreground/3 text-sm leading-tight placeholder:text-foreground/25 md:text-sm"
            spellCheck={false}
          />
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant={hasUnsavedChanges ? 'default' : 'ghost'}
              size="icon-sm"
              aria-label={t('common.save')}
              onClick={handleSave}>
              <Check className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.cancel')}
              onClick={handleCancelEdit}>
              <X className="size-3.5" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto min-w-0 flex-1 justify-start rounded-none px-0 py-0 text-left text-foreground/70 text-sm leading-tight shadow-none hover:bg-transparent hover:text-foreground/80"
            onClick={handleCopy}>
            <span className="min-w-0 truncate">{maskFileProcessingApiKey(item.key)}</span>
          </Button>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.copy')} onClick={handleCopy}>
              <Copy className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.edit')}
              onClick={() => setIsEditing(true)}>
              <EditIcon size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.delete')}
              onClick={() => void handleRemove()}>
              <Minus className="size-3.5" />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export const FileProcessingApiKeyList: FC<FileProcessingApiKeyListProps> = ({ processorId, apiKeys, onSetApiKeys }) => {
  const { t } = useTranslation()
  const { keys, displayItems, hasPendingNewKey, addPendingKey, updateListItem, removeListItem } =
    useFileProcessingApiKeyList({
      processorId,
      apiKeys,
      onSetApiKeys
    })

  return (
    <div className="py-3">
      <div className="overflow-hidden rounded-xl border border-border/60 bg-foreground/2">
        {displayItems.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground text-xs leading-tight">{t('error.no_api_key')}</div>
        ) : (
          <Scrollbar className="max-h-[60vh] overflow-x-hidden">
            <div>
              {displayItems.map((item) => (
                <FileProcessingApiKeyItem
                  key={item.id}
                  item={item}
                  onUpdate={(key) => updateListItem(item, key)}
                  onRemove={() => removeListItem(item)}
                />
              ))}
            </div>
          </Scrollbar>
        )}
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <span className="min-w-0 text-muted-foreground text-xs leading-tight">
          {t('settings.provider.api_key.tip')}
        </span>
        <Button
          type="button"
          size="sm"
          className={cn('h-7 rounded-lg px-3', keys.length === 0 ? undefined : 'shrink-0')}
          onClick={addPendingKey}
          autoFocus={keys.length === 0}
          disabled={hasPendingNewKey}>
          <Plus className="size-3.5" />
          {t('common.add')}
        </Button>
      </div>
    </div>
  )
}

interface ShowParams extends FileProcessingApiKeyListProps {
  title?: string
}

interface PopupProps extends ShowParams {
  resolve: (value: unknown) => void
}

const PopupContainer: FC<PopupProps> = ({ processorId, apiKeys, onSetApiKeys, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const resolvedRef = useRef(false)

  const closePopup = () => {
    if (resolvedRef.current) {
      return
    }

    resolvedRef.current = true
    setOpen(false)
    resolve(null)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : closePopup())}>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle className="text-sm">{title || t('settings.provider.api.key.list.title')}</DialogTitle>
        </DialogHeader>
        <FileProcessingApiKeyList processorId={processorId} apiKeys={apiKeys} onSetApiKeys={onSetApiKeys} />
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'FileProcessingApiKeyListPopup'

export class FileProcessingApiKeyListPopup {
  static show(props: ShowParams) {
    return new Promise<unknown>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(value) => {
            resolve(value)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
