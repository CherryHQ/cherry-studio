import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { type PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgePage } from '../KnowledgePageProvider'

const KnowledgePageShell = ({ children }: PropsWithChildren) => {
  const { t } = useTranslation()
  const { contentRef } = useKnowledgePage()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge.title')}</NavbarCenter>
      </Navbar>

      <div
        ref={contentRef}
        className="flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-1 overflow-hidden bg-background">
        {children}
      </div>
    </div>
  )
}

export default KnowledgePageShell
