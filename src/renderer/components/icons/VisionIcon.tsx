import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ImageIcon } from 'lucide-react'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const VisionIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()
  const { className, ...iconProps } = props as React.HTMLAttributes<HTMLElement> & { className?: string }

  return (
    <div className="flex items-center justify-center">
      <Tooltip content={t('models.type.vision')}>
        <ImageIcon size={15} {...(iconProps as any)} className={cn('mr-[6px] text-primary', className)} />
      </Tooltip>
    </div>
  )
}

export default VisionIcon
