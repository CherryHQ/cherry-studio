import { type FC, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

const EmojiPickerContent = lazy(() => import('./EmojiPickerContent'))

export interface EmojiPickerProps {
  onEmojiClick: (emoji: string) => void
}

const PICKER_FRAME_CLASS =
  'h-88 max-h-[min(22rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-popover text-popover-foreground'

const EmojiPicker: FC<EmojiPickerProps> = (props) => {
  const { t } = useTranslation()

  return (
    <Suspense
      fallback={<div aria-busy="true" aria-label={t('common.loading')} className={PICKER_FRAME_CLASS} role="status" />}>
      <EmojiPickerContent {...props} />
    </Suspense>
  )
}

export default EmojiPicker
