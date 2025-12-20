import type { CollapseProps } from 'antd'
import { Globe } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { WebFetchToolInput, WebFetchToolOutput } from './types'

export function WebFetchTool({
  input,
  output
}: {
  input?: WebFetchToolInput
  output?: WebFetchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: 'tool',
    label: <ToolTitle icon={<Globe className="h-4 w-4" />} label="Web Fetch" params={input?.url} />,
    children: <div>{output}</div>
  }
}
