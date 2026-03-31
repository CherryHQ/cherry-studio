import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { ClickableFilePath } from './ClickableFilePath'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type GrepToolInput, type GrepToolOutput } from './types'

export function GrepTool({
  input,
  output
}: {
  input?: GrepToolInput
  output?: GrepToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算结果行数
  const resultLines = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.Grep,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Grep}
        params={
          <>
            {input?.pattern}
            {input?.output_mode && <span className="ml-1">({input.output_mode})</span>}
          </>
        }
        stats={output ? t('message.tools.units.line', { count: resultLines }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <div>
          {truncatedOutput?.split('\n').map((line, i) => {
            const match = line.match(/^(\/[\w./@+-][^:]*[^:])(:.*)?$/)
            if (match) {
              return (
                <div key={i}>
                  <ClickableFilePath path={match[1]} />
                  {match[2] ?? ''}
                </div>
              )
            }
            return <div key={i}>{line}</div>
          })}
        </div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
