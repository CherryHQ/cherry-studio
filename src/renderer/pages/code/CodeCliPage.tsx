import type { CodeCli } from '@shared/types/codeCli'
import type { FC } from 'react'

import { CodeCliPageView } from './components/CodeCliPageView'
import { useCodeCliPageViewProps } from './hooks/useCodeCliPageViewProps'

interface CodeCliPageProps {
  initialTool?: CodeCli
  onToolChange?: (tool: CodeCli) => void
}

const CodeCliPage: FC<CodeCliPageProps> = ({ initialTool, onToolChange }) => {
  const viewProps = useCodeCliPageViewProps(initialTool, onToolChange)
  return <CodeCliPageView {...viewProps} />
}

export default CodeCliPage
