import { Tooltip } from '@cherrystudio/ui'
import { ArrowLeft, CircleArrowLeft, Copy, Loader2, Pin } from 'lucide-react'
import type { ButtonHTMLAttributes, FC } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

interface FooterProps {
  route: string
  canUseBackspace?: boolean
  loading?: boolean
  setIsPinned: (isPinned: boolean) => void
  isPinned: boolean
  clearClipboard?: () => void
  onEsc: () => void
  onCopy?: () => void
}

const Footer: FC<FooterProps> = ({
  route,
  canUseBackspace,
  loading,
  clearClipboard,
  onEsc,
  setIsPinned,
  isPinned,
  onCopy
}) => {
  const { t } = useTranslation()

  useHotkeys('esc', () => {
    onEsc()
  })

  useHotkeys('c', () => {
    handleCopy()
  })

  const handleCopy = () => {
    if (loading || !onCopy) return
    onCopy()
  }

  return (
    <div className="drag flex flex-row justify-between py-1.5 text-foreground-secondary text-xs">
      <div className="flex items-center justify-center gap-1 text-foreground-secondary text-xs">
        <FooterAction onClick={onEsc}>
          {loading ? (
            <Loader2 size={12} className="animate-spin text-error-base" />
          ) : (
            <CircleArrowLeft size={14} className="text-foreground" />
          )}
          {t('quickAssistant.footer.esc', {
            action: loading
              ? t('quickAssistant.footer.esc_pause')
              : route === 'home'
                ? t('quickAssistant.footer.esc_close')
                : t('quickAssistant.footer.esc_back')
          })}
        </FooterAction>
        {route === 'home' && !canUseBackspace && (
          <FooterAction onClick={() => clearClipboard!()}>
            <ArrowLeft size={14} />
            {t('quickAssistant.footer.backspace_clear')}
          </FooterAction>
        )}
        {route !== 'home' && !loading && (
          <FooterAction onClick={handleCopy}>
            <Copy size={14} className="text-foreground" />
            {t('quickAssistant.footer.copy_last_message')}
          </FooterAction>
        )}
      </div>
      <button
        type="button"
        onClick={() => setIsPinned(!isPinned)}
        className="nodrag me-1 flex items-center text-foreground transition-colors hover:text-primary"
        aria-pressed={isPinned}
        aria-label={t('quickAssistant.tooltip.pin')}>
        <Tooltip placement="left" content={t('quickAssistant.tooltip.pin')} delay={800}>
          <Pin
            size={14}
            className={
              isPinned ? 'rotate-[40deg] text-primary transition-transform' : 'text-foreground transition-transform'
            }
          />
        </Tooltip>
      </button>
    </div>
  )
}

const FooterAction: FC<ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, ...props }) => (
  <button
    type="button"
    className={`nodrag flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground-secondary transition-colors hover:bg-accent hover:text-primary ${className ?? ''}`}
    {...props}
  />
)

export default Footer
