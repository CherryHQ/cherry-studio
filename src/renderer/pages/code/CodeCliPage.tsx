import type { CodeCli } from '@shared/types/codeCli'
import type { FC } from 'react'

import { CodeCliPageView } from './components/CodeCliPageView'
import { useCodeCliPageViewProps } from './hooks/useCodeCliPageViewProps'

interface CodeCliPageProps {
  initialTool?: CodeCli
}

const CodeCliPage: FC<CodeCliPageProps> = ({ initialTool }) => {
  const viewProps = useCodeCliPageViewProps(initialTool)
  return <CodeCliPageView {...viewProps} />
}

export default CodeCliPage
