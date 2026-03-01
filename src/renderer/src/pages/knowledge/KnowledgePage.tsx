import type { FC } from 'react'

import KnowledgeDialogs from './components/KnowledgeDialogs'
import KnowledgeSideNav from './components/KnowledgeSideNav'
import { KnowledgeProvider } from './context'
import KnowledgeContent from './KnowledgeContent'

const KnowledgePage: FC = () => (
  <KnowledgeProvider>
    <div className="flex h-[calc(100vh-var(--navbar-height))] flex-1 flex-col">
      <div className="flex min-h-full flex-1 flex-row">
        <KnowledgeSideNav />
        <KnowledgeContent />
      </div>
      <KnowledgeDialogs />
    </div>
  </KnowledgeProvider>
)

export default KnowledgePage
