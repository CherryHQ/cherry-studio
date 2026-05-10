import RecallSearchBar from './RecallSearchBar'
import RecallTestBody from './RecallTestBody'
import RecallTestProvider from './RecallTestProvider'

interface RecallTestPanelProps {
  baseId: string
}

const RecallTestPanel = ({ baseId }: RecallTestPanelProps) => {
  return (
    <RecallTestProvider key={baseId} baseId={baseId}>
      <div className="flex h-full min-h-0 flex-col">
        <RecallSearchBar />
        <RecallTestBody />
      </div>
    </RecallTestProvider>
  )
}

export default RecallTestPanel
