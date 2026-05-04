/**
 * Cherry-shape renderer for `fs__read`.
 *
 * Output is a discriminated union (`text` / `image` / `pdf` / `media` /
 * `error`) — each kind gets its own body. `text` shows the line-numbered
 * body in CodeViewer; `image` previews inline; `pdf` / `media` show a
 * compact summary (size + mediaType) since rendering raw bytes would be
 * misleading at the chat-card level; `error` surfaces the structured
 * code + message so the model's failure mode is visible.
 */

import CodeViewer from '@renderer/components/CodeViewer'
import { getLanguageByFilePath } from '@renderer/utils/code-language'
import { formatFileSize } from '@renderer/utils/file'
import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { ClickableFilePath } from '../ClickableFilePath'
import { SkeletonValue, ToolHeader } from '../GenericTools'
import type { FsReadInput, FsReadOutput } from './types'

const KEY = 'fs__read'

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

function approxBase64Bytes(b64: string): number {
  // Strip padding to get a tighter upper bound (each `=` strips a byte).
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

export function FsReadTool({
  input,
  output
}: {
  input?: FsReadInput
  output?: FsReadOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const path = input?.path
  const filename = path ? basename(path) : undefined
  const language = path ? getLanguageByFilePath(path) : 'plaintext'

  let stats: string | undefined
  let body: React.ReactNode = <SkeletonValue value={null} width="100%" fallback={null} />

  if (output) {
    if (output.kind === 'text') {
      stats = `${t('message.tools.units.line', { count: output.totalLines })}`
      body = (
        <CodeViewer
          value={output.text}
          language={language}
          expanded={false}
          wrapped={false}
          maxHeight={240}
          options={{ lineNumbers: false }}
        />
      )
    } else if (output.kind === 'image') {
      const bytes = approxBase64Bytes(output.data)
      stats = `${output.mimeType} · ${formatFileSize(bytes)}`
      // Inline preview — `data:` URI works for the standard mime types
      // we emit (image/png, image/jpeg, …).
      body = (
        <img
          src={`data:${output.mimeType};base64,${output.data}`}
          alt={filename ?? 'image'}
          className="max-h-60 max-w-full rounded border border-border"
        />
      )
    } else if (output.kind === 'pdf' || output.kind === 'media') {
      const bytes = approxBase64Bytes(output.data)
      stats = `${output.mediaType} · ${formatFileSize(bytes)}`
      body = (
        <div className="text-muted-foreground text-xs">
          {t('message.tools.fs_read.binary_note', '{{mediaType}} sent inline as {{kind}} chunk', {
            mediaType: output.mediaType,
            kind: output.kind
          })}
        </div>
      )
    } else {
      // error
      stats = output.code
      body = (
        <div className="text-xs">
          <div className="font-mono text-destructive">[{output.code}]</div>
          <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{output.message}</div>
        </div>
      )
    }
  }

  return {
    key: KEY,
    label: (
      <ToolHeader
        toolName="fs__read"
        params={
          <SkeletonValue
            value={path ? <ClickableFilePath path={path} displayName={filename} /> : undefined}
            width="120px"
          />
        }
        stats={stats}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: body
  }
}
