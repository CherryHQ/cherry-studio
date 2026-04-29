import { Button, type ColumnDef, ConfirmDialog, DataTable, EmptyState, RowFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { SettingSubtitle } from '@renderer/pages/settings'
import { deleteCustomLanguage, getAllCustomLanguages } from '@renderer/services/TranslateService'
import type { CustomTranslateLanguage } from '@renderer/types'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CustomLanguageModal from './CustomLanguageModal'

const logger = loggerService.withContext('CustomLanguageSettings')

const CustomLanguageSettings = () => {
  const { t } = useTranslation()
  const [displayedItems, setDisplayedItems] = useState<CustomTranslateLanguage[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomLanguage, setEditingCustomLanguage] = useState<CustomTranslateLanguage>()
  const [deletingCustomLanguage, setDeletingCustomLanguage] = useState<CustomTranslateLanguage | null>(null)

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteCustomLanguage(id)
        setDisplayedItems((prev) => prev.filter((item) => item.id !== id))
        window.toast.success(t('settings.translate.custom.success.delete'))
      } catch (e) {
        window.toast.error(t('settings.translate.custom.error.delete'))
      }
    },
    [t]
  )

  const onClickAdd = () => {
    startTransition(async () => {
      setEditingCustomLanguage(undefined)
      setIsModalOpen(true)
    })
  }

  const onClickEdit = useCallback((target: CustomTranslateLanguage) => {
    startTransition(async () => {
      setEditingCustomLanguage(target)
      setIsModalOpen(true)
    })
  }, [])

  const onCancel = () => {
    startTransition(async () => {
      setIsModalOpen(false)
    })
  }

  const onItemAdd = (target: CustomTranslateLanguage) => {
    startTransition(async () => {
      setDisplayedItems((prev) => [...prev, target])
    })
  }

  const onItemEdit = (target: CustomTranslateLanguage) => {
    startTransition(async () => {
      setDisplayedItems((prev) => prev.map((item) => (item.id === target.id ? target : item)))
    })
  }

  const onConfirmDelete = useCallback(async () => {
    if (!deletingCustomLanguage) {
      return
    }

    await onDelete(deletingCustomLanguage.id)
    setDeletingCustomLanguage(null)
  }, [deletingCustomLanguage, onDelete])

  const columns = useMemo<ColumnDef<CustomTranslateLanguage>[]>(
    () => [
      {
        accessorKey: 'emoji',
        header: 'Emoji',
        meta: { width: 72, align: 'center' },
        cell: ({ getValue }) => <span className="text-base">{getValue<string>()}</span>
      },
      {
        accessorKey: 'value',
        header: t('settings.translate.custom.value.label'),
        meta: { width: '34%' }
      },
      {
        accessorKey: 'langCode',
        header: t('settings.translate.custom.langCode.label'),
        meta: { width: '28%' }
      },
      {
        id: 'action',
        header: t('settings.translate.custom.table.action.title'),
        meta: { width: 84, align: 'center' },
        cell: ({ row }) => {
          const record = row.original

          return (
            <div className="flex items-center gap-1.5">
              <Button
                aria-label={t('common.edit')}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onClickEdit(record)}
                size="icon-sm"
                title={t('common.edit')}
                variant="ghost">
                <Pencil size={14} />
              </Button>
              <Button
                aria-label={t('common.delete')}
                className="text-destructive hover:text-destructive"
                onClick={() => setDeletingCustomLanguage(record)}
                size="icon-sm"
                title={t('common.delete')}
                variant="ghost">
                <Trash2 size={14} />
              </Button>
            </div>
          )
        }
      }
    ],
    [onClickEdit, t]
  )

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await getAllCustomLanguages()
        setDisplayedItems(data)
      } catch (error) {
        logger.error('Failed to load custom languages:', error as Error)
      }
    }
    void loadData()
  }, [])

  return (
    <>
      <div className="flex h-full w-full flex-col justify-between">
        <RowFlex className="justify-between">
          <SettingSubtitle className="mt-0">{t('translate.custom.label')}</SettingSubtitle>
          <Button
            aria-label={t('common.add')}
            onClick={onClickAdd}
            size="icon-sm"
            title={t('common.add')}
            variant="ghost">
            <Plus size={16} />
          </Button>
        </RowFlex>
        <div className="flex flex-1 flex-col">
          <DataTable
            data={displayedItems}
            columns={columns}
            rowKey="id"
            emptyText={<EmptyState compact preset="no-translate" description={t('common.no_results')} />}
            tableLayout="fixed"
          />
        </div>
      </div>
      <ConfirmDialog
        open={deletingCustomLanguage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingCustomLanguage(null)
          }
        }}
        title={t('settings.translate.custom.delete.title')}
        description={t('settings.translate.custom.delete.description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={onConfirmDelete}
      />
      <CustomLanguageModal
        isOpen={isModalOpen}
        editingCustomLanguage={editingCustomLanguage}
        onAdd={onItemAdd}
        onEdit={onItemEdit}
        onCancel={onCancel}
      />
    </>
  )
}

export default memo(CustomLanguageSettings)
