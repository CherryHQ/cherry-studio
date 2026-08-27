import { type CodeEditorProps } from '@cherrystudio/ui'
import { Suspense, lazy } from 'react'

/**
 * Lazily-loaded CodeMirror editing surface.
 *
 * The editor statically pulls the whole CodeMirror stack, and the ui barrel no
 * longer re-exports it for that reason (#19208): read-only rendering paths
 * (chat markdown, previews) must not pay for an edit mode they never enter.
 * The deep import keeps the CodeMirror chunk out of every static graph, and
 * the Suspense fallback renders the current value as plain source so the
 * layout does not collapse while the chunk loads.
 */
const CodeEditorImpl = lazy(async () => {
  const mod = await import('@cherrystudio/ui/components/composites/code-editor')
  return { default: mod.default }
})

export const LazyCodeEditor = ({ value, ...props }: CodeEditorProps) => (
  <Suspense
    fallback={
      <pre className="source-view lazy-code-editor-fallback" aria-busy="true">
        {value}
      </pre>
    }>
    {/* `ref` rides along in props: the editor accepts it as a regular prop (React 19) */}
    <CodeEditorImpl value={value} {...props} />
  </Suspense>
)
