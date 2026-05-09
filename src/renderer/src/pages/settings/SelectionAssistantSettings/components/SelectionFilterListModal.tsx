import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@cherrystudio/ui'
import { isWin } from '@renderer/config/constant'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SelectionFilterListModalProps {
  open: boolean
  onClose: () => void
  filterList?: string[]
  onSave: (list: string[]) => void
}

const SelectionFilterListModal: FC<SelectionFilterListModalProps> = ({ open, onClose, filterList = [], onSave }) => {
  const { t } = useTranslation()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (open) {
      setValue((filterList || []).join('\n'))
    }
  }, [open, filterList])

  const handleSave = () => {
    const newList = value
      .trim()
      .toLowerCase()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    onSave([...new Set(newList)])
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[520px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('selection.settings.filter_modal.title')}</DialogTitle>
        </DialogHeader>
        <div className="text-sm">
          {isWin
            ? t('selection.settings.filter_modal.user_tips.windows')
            : t('selection.settings.filter_modal.user_tips.mac')}
        </div>
        <Textarea.Input
          className="mt-4 w-full [field-sizing:content]"
          rows={6}
          spellCheck={false}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SelectionFilterListModal
