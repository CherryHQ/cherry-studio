import { useTranslation } from 'react-i18next'

import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { formatFileSize } from '@renderer/utils/file'
import { getFilePreviewFileName } from '@renderer/utils/filePreview'

import { AgentToolsType } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { truncateOutput } from '../shared/truncateOutput'
import { extractToolErrorText } from '../toolError'

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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Read results include SDK files, raw text and mixed runtime content; retain only verified text without discarding valid sibling blocks.
const normalizeOutputString = (output: unknown): string | null => {
  if (!output) return null

  const content = typeof output === 'object' && 'content' in output ? output.content : output

  if (Array.isArray(content)) {
    const items: unknown[] = content

    return items
      .flatMap((item) =>
        item !== null &&
        typeof item === 'object' &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string'
          ? [removeSystemReminderTags(item.text)]
          : []
      )
      .join('')
  }

  if (typeof output === 'object' && 'file' in output) {
    const file = output.file

    if (typeof file === 'object' && file !== null && 'content' in file && typeof file.content === 'string') {
      return removeSystemReminderTags(file.content)
    }
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

export function ReadTool({ input, output, hasError }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const errorText = hasError ? extractToolErrorText(output) : undefined
  const outputString = errorText ?? normalizeOutputString(output)
  const stats = errorText ? null : getOutputStats(outputString)
  const filePath = readToolStringArgument(input, 'file_path')
  const filename = filePath ? getFilePreviewFileName(filePath) : undefined
  const language = getLanguageByFilePath(filePath ?? '')
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(outputString)
  const strippedOutput = truncatedOutput ? (errorText ? truncatedOutput : stripLineNumbers(truncatedOutput)) : null

  return {
    key: AgentToolsType.Read,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Read}
        args={input}
        params={
          <SkeletonValue
            value={filePath ? <ClickableFilePath path={filePath} displayName={filename} /> : undefined}
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
          language={errorText ? 'text' : language}
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
