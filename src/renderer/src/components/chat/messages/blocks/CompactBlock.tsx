import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { ChevronDown } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MarkdownSource } from '../markdown/Markdown'
import Markdown from '../markdown/Markdown'
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

  const markdownSource = useMemo<MarkdownSource>(() => ({ id, content, status: 'success' }), [id, content])

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
              <span className="font-medium text-foreground text-sm">{t('message.message.compact.title')}</span>
            </div>
            <ChevronDown size={16} />
          </AccordionTrigger>
          <AccordionContent>
            <div className="py-2 text-foreground-secondary text-sm leading-relaxed">
              <Markdown block={markdownSource} />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {compactedContent && (
        <div className="mt-2">
          <div className="whitespace-pre-wrap text-foreground-secondary text-sm leading-relaxed">
            {compactedContent}
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(CompactBlock)
