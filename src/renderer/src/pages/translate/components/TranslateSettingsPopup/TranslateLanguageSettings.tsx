import { Button, type ColumnDef, ConfirmDialog, DataTable, EmptyState, RowFlex } from '@cherrystudio/ui'
import { useTranslateLanguages } from '@renderer/hooks/translate'
import { SettingSubtitle } from '@renderer/pages/settings'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { memo, startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TranslateLanguagesModal from './TranslateLanguagesModal'

const TranslateLanguageSettings = () => {
  const { t } = useTranslation()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingLanguage, setEditingLanguage] = useState<TranslateLanguage>()
  const [deletingLanguage, setDeletingLanguage] = useState<TranslateLanguage | null>(null)
  const { languages, remove: deleteLanguage } = useTranslateLanguages({ remove: { rethrowError: false } })

  const onClickAdd = () => {
    startTransition(async () => {
      setEditingLanguage(undefined)
      setIsModalOpen(true)
    })
  }

  const onClickEdit = useCallback((target: TranslateLanguage) => {
    startTransition(async () => {
      setEditingLanguage(target)
      setIsModalOpen(true)
    })
  }, [])

  const onCancel = () => {
    startTransition(async () => {
      setIsModalOpen(false)
    })
  }

  const onConfirmDelete = useCallback(async () => {
    if (!deletingLanguage) {
      return
    }

    await deleteLanguage(deletingLanguage.langCode)
    setDeletingLanguage(null)
  }, [deleteLanguage, deletingLanguage])

  const columns = useMemo<ColumnDef<TranslateLanguage>[]>(
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
                onClick={() => setDeletingLanguage(record)}
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
    [t, onClickEdit]
  )

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
            columns={columns}
            data={languages ?? []}
            emptyText={<EmptyState compact preset="no-translate" description={t('common.no_results')} />}
            rowKey="langCode"
            tableLayout="fixed"
          />
        </div>
      </div>
      <ConfirmDialog
        cancelText={t('common.cancel')}
        confirmText={t('common.delete')}
        description={t('settings.translate.custom.delete.description')}
        destructive
        onConfirm={onConfirmDelete}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingLanguage(null)
          }
        }}
        open={deletingLanguage !== null}
        title={t('settings.translate.custom.delete.title')}
      />
      <TranslateLanguagesModal isOpen={isModalOpen} editingLanguage={editingLanguage} onCancel={onCancel} />
    </>
  )
}

export default memo(TranslateLanguageSettings)
