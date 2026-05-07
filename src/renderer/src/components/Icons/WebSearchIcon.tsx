import { Tooltip } from '@cherrystudio/ui'
import { Globe } from 'lucide-react'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const WebSearchIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-center">
      <Tooltip content={t('models.type.websearch')}>
        <Globe
          {...(props as React.SVGProps<SVGSVGElement>)}
          size={15}
          className={props.className}
          style={{
            color: 'var(--color-link)',
            marginRight: 6,
            ...props.style
          }}
        />
      </Tooltip>
    </div>
  )
}

export default WebSearchIcon
