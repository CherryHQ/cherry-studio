import { cn } from '@renderer/utils/style'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedSettingsButton } from './PanelPrimitives'

/**
 * Collapsible "Advanced Settings" section. The trigger mirrors McpSettings'
 * advanced-settings affordance (ChevronDown, rotates 180° on open); the body
 * animates height/opacity via motion (SettingGroup pattern). Consumers pass
 * content as children.
 */
export const AdvancedConfigToggle: FC<{ open: boolean; onToggle: () => void; children?: ReactNode }> = ({
  open,
  onToggle,
  children
}) => {
  const { t } = useTranslation()
  return (
    <div data-state={open ? 'open' : 'closed'}>
      <AdvancedSettingsButton onClick={onToggle}>
        <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        {t('common.advanced_settings')}
      </AdvancedSettingsButton>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}>
            <div className="pt-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
