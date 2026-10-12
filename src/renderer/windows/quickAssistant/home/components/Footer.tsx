import { ArrowLeft, Copy, LogOut } from 'lucide-react'
import type { ButtonHTMLAttributes, FC } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'

interface FooterProps {
  route: string
  canUseBackspace?: boolean
  loading?: boolean
  clearClipboard?: () => void
  onEsc: () => void
  onCopy?: () => void
}

const Footer: FC<FooterProps> = ({ route, canUseBackspace, loading, clearClipboard, onEsc, onCopy }) => {
  const { t } = useTranslation()

  useHotkeys('esc', onEsc, { preventDefault: true }, [onEsc])

  useHotkeys('c', () => handleCopy(), { preventDefault: true }, [loading, onCopy])

  const handleCopy = () => {
    if (loading || !onCopy) return
    onCopy()
  }

  return (
    <div className="drag flex flex-row justify-between py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <FooterAction onClick={onEsc}>
          <LogOut size={14} />
          {t('quickAssistant.footer.esc', { action: t('quickAssistant.footer.esc_close') })}
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
    </div>
  )
}

const FooterAction: FC<ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, ...props }) => (
  <Button
    variant="ghost"
    size="sm"
    className={`nodrag h-auto gap-1 px-1.5 py-1 text-xs text-muted-foreground ${className ?? ''}`}
    {...props}
  />
)

export default Footer
