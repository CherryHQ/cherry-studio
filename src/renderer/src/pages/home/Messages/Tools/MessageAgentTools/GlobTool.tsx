import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { ClickableFilePath } from './ClickableFilePath'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import {
  AgentToolsType,
  type GlobToolInput as GlobToolInputType,
  type GlobToolOutput as GlobToolOutputType
} from './types'

export function GlobTool({
  input,
  output
}: {
  input?: GlobToolInputType
  output?: GlobToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算文件数量
  const lineCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.Glob,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Glob}
        params={input?.pattern}
        stats={output ? t('message.tools.units.file', { count: lineCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <div>
          {truncatedOutput?.split('\n').map((line, i) =>
            line.startsWith('/') ? (
              <div key={i}>
                <ClickableFilePath path={line} />
              </div>
            ) : (
              <div key={i}>{line}</div>
            )
          )}
        </div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
