import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { ChevronDown } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MarkdownSource } from '../../Markdown/Markdown'
import Markdown from '../../Markdown/Markdown'
import { useScrollAnchor } from './useScrollAnchor'

interface Props {
  /** Stable ID for heading prefix */
  id: string
  /** Summary content (markdown) */
  content: string
  /** Original compacted content */
  compactedContent: string
}

const CompactBlock: React.FC<Props> = ({ id, content, compactedContent }) => {
  const { t } = useTranslation()
  const [activeKey, setActiveKey] = useState<string>('')
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

  const markdownSource = useMemo<MarkdownSource>(
    () => ({ id, content, status: MessageBlockStatus.SUCCESS }),
    [id, content]
  )

  return (
    <div className="my-2 flex flex-col gap-3">
      <Accordion
        ref={anchorRef}
        type="single"
        collapsible
        value={activeKey}
        onValueChange={(value) => withScrollAnchor(() => setActiveKey(value))}>
        <AccordionItem value="summary" className="rounded-lg border-0">
          <AccordionTrigger className="[&>svg]:hidden">
            <div className="flex items-center gap-2">
              <span className="text-lg">📦</span>
              <span className="font-medium text-(--color-text-1) text-sm">{t('message.message.compact.title')}</span>
            </div>
            <ChevronDown size={16} />
          </AccordionTrigger>
          <AccordionContent>
            <div className="py-2 text-(--color-text-2) text-sm leading-relaxed">
              <Markdown block={markdownSource} />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {compactedContent && (
        <div className="mt-2">
          <div className="whitespace-pre-wrap text-(--color-text-2) text-sm leading-relaxed">{compactedContent}</div>
        </div>
      )}
    </div>
  )
}

export default React.memo(CompactBlock)
