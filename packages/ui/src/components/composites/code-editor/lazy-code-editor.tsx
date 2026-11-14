import { lazy, Suspense } from 'react'

import type { CodeEditorProps } from './types'

// Keep CodeMirror out of the public barrel's static module graph.
const CodeEditorImpl = lazy(() => import('./code-editor'))
const SharedSyntaxEditorImpl = lazy(() =>
  import('./code-editor').then((module) => ({ default: module.SharedSyntaxEditor }))
)

export default function LazyCodeEditor({ value, fallback, ...props }: CodeEditorProps) {
  const { expanded = true, height, minHeight, maxHeight, className, style, wrapped = true, fontSize = 16 } = props
  return (
    <Suspense
      fallback={
        fallback ?? (
          <pre
            className={`code-editor ${className ?? ''}`}
            aria-busy="true"
            style={{
              margin: 0,
              overflow: 'auto',
              whiteSpace: wrapped ? 'pre-wrap' : 'pre',
              fontSize,
              minHeight,
              ...(expanded ? undefined : { height, maxHeight }),
              ...style
            }}>
            {value}
          </pre>
        )
      }>
      {props.syntaxHighlightStyle ? (
        <SharedSyntaxEditorImpl value={value} {...props} />
      ) : (
        <CodeEditorImpl value={value} {...props} />
      )}
    </Suspense>
  )
}
