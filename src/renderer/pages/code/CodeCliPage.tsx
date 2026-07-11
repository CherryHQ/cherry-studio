import type { FC } from 'react'

import { CodeCliPageView } from './components/CodeCliPageView'
import { useCodeCliPageViewProps } from './hooks/useCodeCliPageViewProps'

const CodeCliPage: FC = () => {
  const viewProps = useCodeCliPageViewProps()
  return <CodeCliPageView {...viewProps} />
}

export default CodeCliPage
