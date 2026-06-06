import RecallSearchBar from './RecallSearchBar'
import RecallTestBody from './RecallTestBody'
import RecallTestProvider from './RecallTestProvider'

interface RecallTestPanelProps {
  baseId: string
}

const RecallTestPanel = ({ baseId }: RecallTestPanelProps) => {
  return (
    <RecallTestProvider key={baseId} baseId={baseId}>
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-x-hidden bg-background">
        <div className="min-w-0 px-6">
          <RecallSearchBar />
        </div>
        <div className="min-h-0 min-w-0 overflow-x-hidden">
          <RecallTestBody />
        </div>
      </div>
    </RecallTestProvider>
  )
}

export default RecallTestPanel
