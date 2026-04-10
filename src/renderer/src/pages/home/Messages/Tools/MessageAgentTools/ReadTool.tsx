import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/code-language'
import { formatFileSize } from '@renderer/utils/file'
import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { truncateOutput } from '../shared/truncateOutput'
import { ClickableFilePath } from './ClickableFilePath'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from './GenericTools'
import type { ReadToolInput as ReadToolInputType, ReadToolOutput as ReadToolOutputType, TextOutput } from './types'
import { AgentToolsType } from './types'

const removeSystemReminderTags = (text: string): string => {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
}

/**
 * Strip line number prefixes from Read tool output.
 * The model returns lines like: "     1→content" or "    10→content"
 * Pattern: optional spaces + digits + arrow (→) + actual content
 */
const stripLineNumbers = (text: string): string => {
  return text.replace(/^ *\d+→/gm, '')
}

const normalizeOutputString = (output?: ReadToolOutputType): string | null => {
  if (!output) return null

  const toText = (item: TextOutput) => removeSystemReminderTags(item.text)

  if (Array.isArray(output)) {
    return output
      .filter((item): item is TextOutput => item.type === 'text')
      .map(toText)
      .join('')
  }

  if (typeof output !== 'string') return null

  return removeSystemReminderTags(output)
}

const getOutputStats = (outputString: string | null) => {
  if (!outputString) return null

  return {
    lineCount: outputString.split('\n').length,
    fileSize: new Blob([outputString]).size
  }
}

export function ReadTool({
  input,
  output
}: {
  input?: ReadToolInputType
  output?: ReadToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const outputString = normalizeOutputString(output)
  const stats = getOutputStats(outputString)
  const filename = input?.file_path?.split('/').pop()
  const language = getLanguageByFilePath(input?.file_path ?? '')
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(outputString)
  const strippedOutput = truncatedOutput ? stripLineNumbers(truncatedOutput) : null

  return {
    key: AgentToolsType.Read,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Read}
        params={
          <SkeletonValue
            value={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
            width="120px"
          />
        }
        stats={
          stats
            ? `${t('message.tools.units.line', { count: stats.lineCount })}, ${formatFileSize(stats.fileSize)}`
            : undefined
        }
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: strippedOutput ? (
      <div>
        <CodeViewer
          value={strippedOutput}
          language={language}
          expanded={false}
          wrapped={false}
          maxHeight={240}
          options={{ lineNumbers: true }}
        />
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    ) : (
      <SkeletonValue value={null} width="100%" fallback={null} />
    )
  }
}
