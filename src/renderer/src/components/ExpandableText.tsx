import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ExpandableTextProps {
  text: string
  style?: React.CSSProperties
}

const ExpandableText = ({
  ref,
  text,
  style
}: ExpandableTextProps & { ref?: React.RefObject<HTMLParagraphElement> | null }) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  return (
    <div ref={ref} className={cn('flex', isExpanded ? 'flex-col' : 'flex-row')} style={style}>
      <div className={cn('overflow-hidden', isExpanded ? 'whitespace-normal' : 'truncate leading-[30px]')}>{text}</div>
      <Button variant="ghost" onClick={toggleExpand} className="self-end">
        {isExpanded ? t('common.collapse') : t('common.expand')}
      </Button>
    </div>
  )
}

export default ExpandableText
