import type { CollapseProps } from 'antd'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { truncateOutput } from '../shared/truncateOutput'
import { ToolTitle, TruncatedIndicator } from './GenericTools'
import type { WebFetchToolInput, WebFetchToolOutput } from './types'

export function WebFetchTool({
  input,
  output
}: {
  input?: WebFetchToolInput
  output?: WebFetchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: 'tool',
    label: (
      <ToolTitle icon={<Globe className="h-4 w-4" />} label={t('message.tools.labels.webFetch')} params={input?.url} />
    ),
    children: (
      <div>
        <div>{truncatedOutput}</div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
