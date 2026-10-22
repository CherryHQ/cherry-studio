import type { FC } from 'react'

import type { CodeCli } from '@shared/types/codeCli'

import { useCodeCliPageViewProps } from '../hooks/useCodeCliPageViewProps'
import { CodeCliPageView } from './CodeCliPageView'

interface CodeCliPageProps {
  initialTool?: CodeCli
  onToolChange?: (tool: CodeCli) => void
}

export const CodeCliConfiguration: FC<CodeCliPageProps & { embedded?: boolean }> = ({
  initialTool,
  onToolChange,
  embedded
}) => {
  const viewProps = useCodeCliPageViewProps(initialTool, onToolChange)
  return <CodeCliPageView {...viewProps} embedded={embedded} />
}
