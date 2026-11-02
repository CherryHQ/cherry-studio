import type { FC } from 'react'

import type { CodeCli } from '@shared/types/codeCli'

import { useCodeCliPageViewProps } from '../hooks/useCodeCliPageViewProps'
import { CodeCliPageView } from './CodeCliPageView'

interface CodeCliConfigurationProps {
  initialTool: CodeCli
}

export const CodeCliConfiguration: FC<CodeCliConfigurationProps> = ({ initialTool }) => {
  const viewProps = useCodeCliPageViewProps(initialTool)
  return <CodeCliPageView {...viewProps} />
}
