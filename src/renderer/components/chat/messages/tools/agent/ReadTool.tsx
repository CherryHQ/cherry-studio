import { useTranslation } from 'react-i18next'

import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { formatFileSize } from '@renderer/utils/file'

import type {
  ReadToolInput as ReadToolInputType,
  ReadToolOutput as ReadToolOutputType,
  TextOutput
} from '../shared/agentToolTypes'
import { AgentToolsType } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
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

const READ_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getReadImages = (output: unknown): Array<{ data: string; mimeType: string }> => {
  const items = Array.isArray(output) ? output : [output]
  return items.flatMap((item) => {
    if (!isRecord(item) || item.type !== 'image') return []
    const source = isRecord(item.source) && item.source.type === 'base64' ? item.source : undefined
    const file = isRecord(item.file) ? item.file : undefined
    const data = source?.data ?? file?.base64
    const mimeType = source?.media_type ?? file?.type
    if (typeof data !== 'string' || !data || typeof mimeType !== 'string' || !READ_IMAGE_MIME_TYPES.has(mimeType))
      return []
    return [{ data, mimeType }]
  })
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

export function ReadTool({
  input,
  output,
  hasError
}: {
  input?: ReadToolInputType
  output?: ReadToolOutputType
  hasError?: boolean
}): ToolDisclosureItem {
  const { t } = useTranslation()
  const errorText = hasError ? extractToolErrorText(output) : undefined
  const outputString = errorText ?? normalizeOutputString(output)
  const images = hasError ? [] : getReadImages(output)
  const stats = errorText ? null : getOutputStats(outputString)
  const filename = input?.file_path?.split('/').pop()
  const language = getLanguageByFilePath(input?.file_path ?? '')
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
    children:
      strippedOutput || images.length > 0 ? (
        <div className="space-y-2">
          {strippedOutput && (
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
          )}
          {images.map((image, index) => (
            <img
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={t('message.tools.sections.output')}
              className="max-w-[300px] rounded"
            />
          ))}
        </div>
      ) : (
        <SkeletonValue value={null} width="100%" fallback={null} />
      )
  }
}
