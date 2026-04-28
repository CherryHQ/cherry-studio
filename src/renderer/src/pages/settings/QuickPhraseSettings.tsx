import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Flex,
  Input,
  Textarea
} from '@cherrystudio/ui'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import FileItem from '@renderer/pages/files/FileItem'
import QuickPhraseService from '@renderer/services/QuickPhraseService'
import type { QuickPhrase } from '@renderer/types'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const QuickPhraseSettings: FC = () => {
  const { t } = useTranslation()
  const [phrasesList, setPhrasesList] = useState<QuickPhrase[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPhrase, setEditingPhrase] = useState<QuickPhrase | null>(null)
  const [formData, setFormData] = useState({ title: '', content: '' })
  const [dragging, setDragging] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { theme } = useTheme()

  const loadPhrases = async () => {
    const data = await QuickPhraseService.getAll()
    setPhrasesList(data)
  }

  useEffect(() => {
    void loadPhrases()
  }, [])

  const handleAdd = () => {
    setEditingPhrase(null)
    setFormData({ title: '', content: '' })
    setIsModalOpen(true)
  }

  const handleEdit = (phrase: QuickPhrase) => {
    setEditingPhrase(phrase)
    setFormData({ title: phrase.title, content: phrase.content })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    await QuickPhraseService.delete(id)
    await loadPhrases()
  }

  const handleModalOk = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    if (editingPhrase) {
      await QuickPhraseService.update(editingPhrase.id, formData)
    } else {
      await QuickPhraseService.add(formData)
    }
    setIsModalOpen(false)
    await loadPhrases()
  }

  const handleUpdateOrder = async (newPhrases: QuickPhrase[]) => {
    setPhrasesList(newPhrases)
    await QuickPhraseService.updateOrder(newPhrases)
  }

  const reversedPhrases = [...phrasesList].reverse()

  return (
    <SettingContainer theme={theme}>
      <SettingGroup style={{ marginBottom: 0 }} theme={theme}>
        <SettingTitle>
          {t('settings.quickPhrase.title')}
          <Button variant="ghost" onClick={handleAdd} size="icon">
            <PlusIcon size={18} />
          </Button>
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <div className="flex h-[calc(100vh-162px)] w-full flex-col gap-2 overflow-y-auto">
            <DraggableList
              list={reversedPhrases}
              onUpdate={(newPhrases) => handleUpdateOrder([...newPhrases].reverse())}
              style={{ paddingBottom: dragging ? '34px' : 0 }}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}>
              {(phrase) => (
                <FileItem
                  key={phrase.id}
                  fileInfo={{
                    name: phrase.title,
                    ext: '.txt',
                    extra: phrase.content,
                    actions: (
                      <Flex className="gap-1 opacity-60">
                        <Button key="edit" variant="ghost" onClick={() => handleEdit(phrase)} size="icon">
                          <EditIcon size={14} />
                        </Button>
                        <Button key="delete" variant="ghost" onClick={() => setPendingDeleteId(phrase.id)} size="icon">
                          <DeleteIcon size={14} className="lucide-custom" />
                        </Button>
                      </Flex>
                    )
                  }}
                />
              )}
            </DraggableList>
          </div>
        </SettingRow>
      </SettingGroup>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent
          className="sm:max-w-[520px]"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingPhrase ? t('settings.quickPhrase.edit') : t('settings.quickPhrase.add')}</DialogTitle>
          </DialogHeader>
          <div className="flex w-full flex-col gap-4">
            <div>
              <div className="mb-2 text-foreground text-sm">{t('settings.quickPhrase.titleLabel')}</div>
              <Input
                placeholder={t('settings.quickPhrase.titlePlaceholder')}
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>
            <div>
              <div className="mb-2 text-foreground text-sm">{t('settings.quickPhrase.contentLabel')}</div>
              <Textarea.Input
                placeholder={t('settings.quickPhrase.contentPlaceholder')}
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows={6}
                style={{ resize: 'none' }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleModalOk}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
        title={t('settings.quickPhrase.delete')}
        description={t('settings.quickPhrase.deleteConfirm')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (pendingDeleteId) {
            await handleDelete(pendingDeleteId)
            setPendingDeleteId(null)
          }
        }}
      />
    </SettingContainer>
  )
}

export default QuickPhraseSettings
