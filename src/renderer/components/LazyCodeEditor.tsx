import { type CodeEditorProps } from '@cherrystudio/ui'
import { codeBlockHighlightStyle } from '@cherrystudio/ui/code-block'
import Editor from '@cherrystudio/ui/components/composites/code-editor'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'

export function LazyCodeEditor(props: CodeEditorProps) {
  const { codeBlockStyle, isCodeThemeDark } = useCodeStyle()
  return (
    <Editor
      {...props}
      theme={isCodeThemeDark ? 'dark' : 'light'}
      syntaxHighlightStyle={codeBlockHighlightStyle}
      style={{
        ...codeBlockStyle,
        backgroundColor: 'var(--code-background)',
        color: 'var(--code-foreground)',
        ...props.style
      }}
    />
  )
}
