import { useTranslation } from 'react-i18next'

import {
  AgentToolsType,
  type GlobToolInput as GlobToolInputType,
  type GlobToolOutput as GlobToolOutputType
} from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { countLines, truncateOutput } from '../shared/truncateOutput'
import { TerminalContainer } from './TerminalOutput'

export function GlobTool({
  input,
  output
}: {
  input?: GlobToolInputType
  output?: GlobToolOutputType
}): ToolDisclosureItem {
  const { t } = useTranslation()
  // 如果有输出，计算文件数量
  const lineCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.Glob,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Glob}
        args={input}
        stats={output ? t('message.tools.units.file', { count: lineCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <TerminalContainer>
          {truncatedOutput?.split('\n').map((line, i) =>
            line.startsWith('/') ? (
              <div key={i}>
                <ClickableFilePath path={line} />
              </div>
            ) : (
              <div key={i}>{line}</div>
            )
          )}
        </TerminalContainer>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
