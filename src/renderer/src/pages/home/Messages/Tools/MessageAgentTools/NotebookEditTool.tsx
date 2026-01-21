import type { CollapseProps } from 'antd'
import { Tag } from 'antd'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { truncateOutput } from '../shared/truncateOutput'
import { ToolTitle, TruncatedIndicator } from './GenericTools'
import type { NotebookEditToolInput, NotebookEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function NotebookEditTool({
  input,
  output
}: {
  input?: NotebookEditToolInput
  output?: NotebookEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const { text: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.NotebookEdit,
    label: (
      <>
        <ToolTitle icon={<FileText className="h-4 w-4" />} label={t('message.tools.labels.notebookEdit')} />
        <Tag className="mt-1" color="blue">
          {input?.notebook_path}{' '}
        </Tag>
      </>
    ),
    children: (
      <div>
        <ReactMarkdown>{truncatedOutput}</ReactMarkdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
