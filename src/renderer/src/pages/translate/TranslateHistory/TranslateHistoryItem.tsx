import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useDeleteHistory, useLanguages, useUpdateHistory } from '@renderer/hooks/translate'
import type { TranslateHistory } from '@shared/data/types/translate'
import dayjs from 'dayjs'
import { StarIcon, TrashIcon } from 'lucide-react'
import type { ComponentPropsWithoutRef } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type TranslateHistoryItemProps = {
  data: TranslateHistory
  onClick: () => void
}

export const TranslateHistoryItem = ({ data, onClick }: TranslateHistoryItemProps) => {
  const { t } = useTranslation()
  const updateHistory = useUpdateHistory(data.id)
  const deleteHistory = useDeleteHistory(data.id)
  const { getLabel } = useLanguages()

  const preparedData = useMemo(() => {
    return {
      id: data.id,
      sourceLang: getLabel(data.sourceLanguage),
      targetLang: getLabel(data.targetLanguage),
      sourceText: data.sourceText,
      targetText: data.targetText,
      star: data.star,
      createdAt: dayjs(data.createdAt).format('MM/DD HH:mm')
    }
  }, [data, getLabel])

  const handleStar = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!preparedData) {
        return
      }
      return updateHistory({ star: !preparedData.star })
    },
    [preparedData, updateHistory]
  )

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!preparedData) {
        return
      }
      return await deleteHistory()
    },
    [preparedData, deleteHistory]
  )

  if (!preparedData) {
    return (
      <Container>
        <Skeleton className="flex-1" />
      </Container>
    )
  }

  return (
    <Container onClick={onClick}>
      <div className="flex h-7.5 items-center justify-between">
        {/* Lang */}
        <div className="flex items-center gap-1.5">
          <div className="text-foreground-secondary text-xs">{preparedData.sourceLang} →</div>
          <div className="text-foreground-secondary text-xs">{preparedData.targetLang}</div>
        </div>
        {/* Tool bar */}
        <div className="mt-2 flex items-center justify-end">
          <Button variant="ghost" onClick={handleStar} className="">
            {preparedData.star ? (
              <StarIcon fill="yellow" className="hover:primary" />
            ) : (
              <StarIcon className="hover:primary" />
            )}
          </Button>
          <Popover>
            <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="destructive">
                <TrashIcon className="text-destructive" />
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <div>{t('translate.history.delete')}</div>
              <footer className="flex flex-end p-2">
                <Button onClick={handleDelete}>{t('common.confirm')}</Button>
              </footer>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {/* Text */}
      <div className="flex flex-1 flex-col">
        <div className="flex-1 line-clamp-2 overflow-hidden truncate text-sm">{preparedData.sourceText}</div>
        <div className="flex-1 line-clamp-2 overflow-hidden truncate text-foreground-secondary text-sm">
          {preparedData.targetText}
        </div>
      </div>
      {/* Timestamp */}
      <div className="text-foreground-secondary text-xs">{preparedData.createdAt}</div>
    </Container>
  )
}

const Container = ({ children, className, onClick }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <div
      className={cn(
        'relative flex h-40 flex-1 cursor-pointer flex-col justify-between gap-1 px-6 py-2.5 transition-colors hover:bg-muted border-b border-dashed',
        className
      )}
      onClick={onClick}>
      {children}
    </div>
  )
}
