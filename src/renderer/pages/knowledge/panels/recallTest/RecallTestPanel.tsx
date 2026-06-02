import RecallSearchBar from './RecallSearchBar'
import RecallTestBody from './RecallTestBody'
import RecallTestProvider from './RecallTestProvider'

interface RecallTestPanelProps {
  baseId: string
}

const RecallTestPanel = ({ baseId }: RecallTestPanelProps) => {
  return (
    <RecallTestProvider key={baseId} baseId={baseId}>
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
        <div className="px-6 py-5">
          <RecallSearchBar />
        </div>
        <div className="min-h-0">
          <RecallTestBody />
        </div>
      </div>
    </RecallTestProvider>
  )
}

export default RecallTestPanel
