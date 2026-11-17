import { useEffect } from 'react'

import { type CodeEditorProps } from '@cherrystudio/ui'
import Editor from '@cherrystudio/ui/components/composites/code-editor'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'

export function LazyCodeEditor(props: CodeEditorProps) {
  const { activeCmTheme, requestCmTheme } = useCodeStyle()
  const sharedSyntax = props.syntaxHighlightStyle !== undefined
  useEffect(() => {
    if (!sharedSyntax) requestCmTheme?.()
  }, [sharedSyntax, requestCmTheme])
  return <Editor {...props} theme={props.theme ?? activeCmTheme} />
}
