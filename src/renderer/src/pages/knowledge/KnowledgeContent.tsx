import type { FC } from 'react'

import KnowledgeTabs from './components/KnowledgeTabs'
import KnowledgeToolbar from './components/KnowledgeToolbar'
import { useKnowledgeBaseCtx } from './context'

const KnowledgeContent: FC = () => {
  const { selectedBase } = useKnowledgeBaseCtx()

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex w-full min-w-0 flex-col">
      <KnowledgeToolbar />
      <KnowledgeTabs />
    </div>
  )
}

export default KnowledgeContent
