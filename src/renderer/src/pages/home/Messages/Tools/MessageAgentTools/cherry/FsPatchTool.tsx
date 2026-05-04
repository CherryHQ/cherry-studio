/**
 * Cherry-shape renderer for `fs__patch` (Codex-format multi-file patch).
 *
 * The input is a single `patch` string (Codex envelope). On parse
 * we split it into per-file ops to render a per-file summary card
 * pre-execute (model wrote the patch but it hasn't been applied yet —
 * useful for the approval state).
 *
 * Output is a discriminated union (`applied` / `parse-error` /
 * `apply-error`). On `apply-error: context-mismatch` we surface the
 * 5-line actualContext window the applier sends back so the model can
 * see what the file actually contains around the intended apply point.
 */

import CodeViewer from '@renderer/components/CodeViewer'
import type { CollapseProps } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ClickableFilePath } from '../ClickableFilePath'
import { SkeletonValue, ToolHeader, useIsStreaming } from '../GenericTools'
import type { FsPatchInput, FsPatchOpSummary, FsPatchOutput } from './types'

const KEY = 'fs__patch'

interface ParsedOp {
  op: 'add' | 'update' | 'delete'
  path: string
}

/**
 * Lightweight envelope scan to extract the op headers — this is for
 * the pre-execute preview only (so the user can see what files the
 * patch will touch before approving). We do NOT parse hunks here;
 * applier output already carries the canonical results.
 */
function scanPatchOps(patch: string): ParsedOp[] {
  const ops: ParsedOp[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('*** Add File:')) ops.push({ op: 'add', path: line.slice('*** Add File:'.length).trim() })
    else if (line.startsWith('*** Update File:'))
      ops.push({ op: 'update', path: line.slice('*** Update File:'.length).trim() })
    else if (line.startsWith('*** Delete File:'))
      ops.push({ op: 'delete', path: line.slice('*** Delete File:'.length).trim() })
  }
  return ops
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

function renderResultLine(r: FsPatchOpSummary): string {
  if (r.type === 'added') return `+ ${r.path} (${r.lines} lines)`
  if (r.type === 'updated') return `~ ${r.path} (${r.hunksApplied} hunks)`
  return `− ${r.path}`
}

export function FsPatchTool({
  input,
  output
}: {
  input?: FsPatchInput
  output?: FsPatchOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const isStreaming = useIsStreaming()
  // Skip the env-scan during streaming. The model emits the `patch`
  // string char-by-char; re-running scanPatchOps + reflowing N file
  // rows on every delta chokes the main thread for big patches
  // (10+ files, 5-12 KB JSON-encoded). Show a lightweight placeholder
  // until the input is committed.
  const previewOps = useMemo(
    () => (!isStreaming && input?.patch ? scanPatchOps(input.patch) : []),
    [isStreaming, input?.patch]
  )
  const patchByteLength = input?.patch?.length ?? 0

  let stats: string | undefined
  let body: React.ReactNode

  if (isStreaming && !output) {
    // During streaming, show only a byte counter — no envelope parse,
    // no per-file rows, no codeviewer.
    stats = `streaming · ${patchByteLength}B`
    body = (
      <div className="text-muted-foreground text-xs">
        {t('message.tools.fs_patch.streaming', 'Receiving patch ({{bytes}} bytes)…', { bytes: patchByteLength })}
      </div>
    )
  } else if (!output) {
    // Pre-execute (likely approval-pending). Show per-op summary.
    stats = previewOps.length ? `${previewOps.length} ops` : undefined
    body =
      previewOps.length > 0 ? (
        <div className="flex flex-col gap-1 text-xs">
          {previewOps.map((op, i) => (
            <div key={`${op.path}-${i}`} className="flex items-center gap-2">
              <span
                className={
                  op.op === 'add' ? 'text-success' : op.op === 'delete' ? 'text-destructive' : 'text-muted-foreground'
                }>
                {op.op === 'add' ? '+' : op.op === 'delete' ? '−' : '~'}
              </span>
              <ClickableFilePath path={op.path} displayName={basename(op.path)} />
            </div>
          ))}
        </div>
      ) : (
        <SkeletonValue value={null} width="100%" fallback={null} />
      )
  } else if (output.kind === 'applied') {
    stats = `${output.results.length} ${t('message.tools.units.op', { count: output.results.length, defaultValue: 'ops' })}`
    body =
      output.results.length > 0 ? (
        <div className="flex flex-col gap-1 font-mono text-xs">
          {output.results.map((r, i) => (
            <div key={i}>{renderResultLine(r)}</div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground text-xs">{t('message.tools.fs_patch.no_changes', 'No changes')}</div>
      )
  } else if (output.kind === 'parse-error') {
    stats = 'parse-error'
    body = (
      <div className="text-xs">
        <div className="font-mono text-destructive">[parse-error]</div>
        <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{output.message}</div>
      </div>
    )
  } else {
    // apply-error
    stats = output.reason
    const contextWindow = output.actualContext
    body = (
      <div className="text-xs">
        <div className="font-mono text-destructive">[apply-error: {output.reason}]</div>
        {output.path && (
          <div className="mt-1">
            <ClickableFilePath path={output.path} displayName={basename(output.path)} />
            {output.hunkIndex !== undefined && <span className="ml-2">hunk #{output.hunkIndex}</span>}
            {output.totalLines !== undefined && (
              <span className="ml-2 text-muted-foreground">
                ({t('message.tools.units.line', { count: output.totalLines })})
              </span>
            )}
          </div>
        )}
        <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{output.message}</div>
        {contextWindow && contextWindow.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 font-medium text-muted-foreground">
              {t('message.tools.fs_patch.actual_context', 'Actual file content (lines {{from}}-{{to}})', {
                from: output.actualContextStart ?? 1,
                to: (output.actualContextStart ?? 1) + contextWindow.length - 1
              })}
            </div>
            <CodeViewer
              value={contextWindow.join('\n')}
              language="plaintext"
              expanded={false}
              wrapped={false}
              maxHeight={120}
              options={{ lineNumbers: false }}
            />
          </div>
        )}
      </div>
    )
  }

  return {
    key: KEY,
    label: (
      <ToolHeader
        toolName="fs__patch"
        params={
          <SkeletonValue value={previewOps.length > 0 ? `${previewOps.length} files` : undefined} width="100px" />
        }
        stats={stats}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: body
  }
}
