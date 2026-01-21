import type { CollapseProps } from 'antd'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ToolTitle } from './GenericTools'
import type { WriteToolInput, WriteToolOutput } from './types'

export function WriteTool({
  input
}: {
  input?: WriteToolInput
  output?: WriteToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<FileText className="h-4 w-4" />}
        label={t('message.tools.labels.write')}
        params={input?.file_path}
      />
    ),
    children: <div>{input?.content}</div>
  }
}
