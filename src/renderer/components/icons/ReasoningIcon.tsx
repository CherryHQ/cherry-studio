import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

const ReasoningIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()
  const { className, ...iconProps } = props

  return (
    <div className="flex items-center justify-center">
      <Tooltip content={t('models.type.reasoning')}>
        <i
          {...(iconProps as any)}
          className={cn('iconfont icon-thinking mr-[6px] text-[16px] text-primary', className)}
        />
      </Tooltip>
    </div>
  )
}

export default ReasoningIcon
