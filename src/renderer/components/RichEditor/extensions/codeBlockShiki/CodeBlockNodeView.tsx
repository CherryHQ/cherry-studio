import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip } from '@cherrystudio/ui'
import { SPECIAL_VIEW_COMPONENTS, SPECIAL_VIEWS } from '@renderer/components/CodeBlockView/constants'
import { DEFAULT_LANGUAGES, getHighlighter, getShiki } from '@renderer/utils/shiki'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react'
import { Code, Copy, Eye } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CodeBlockNodeView: FC<ReactNodeViewProps> = (props) => {
  const { node, updateAttributes, editor } = props
  const { t } = useTranslation()
  const [languageOptions, setLanguageOptions] = useState<string[]>(DEFAULT_LANGUAGES)

  // Detect language from node attrs or fallback
  const language = (node.attrs.language as string) || 'text'
  const isSpecialView = SPECIAL_VIEWS.includes(language)
  const isEditable = editor.isEditable
  const [showPreview, setShowPreview] = useState(true)

  // Build language options with 'text' always available
  useEffect(() => {
    const loadLanguageOptions = async () => {
      try {
        const shiki = await getShiki()
        const highlighter = await getHighlighter()

        // Get bundled languages from shiki
        const bundledLanguages = Object.keys(shiki.bundledLanguages)

        // Combine with loaded languages
        const loadedLanguages = highlighter.getLoadedLanguages()

        const allLanguages = Array.from(new Set(['text', ...bundledLanguages, ...loadedLanguages]))

        setLanguageOptions(allLanguages)
      } catch {
        setLanguageOptions(DEFAULT_LANGUAGES)
      }
    }

    void loadLanguageOptions()
  }, [])

  // Handle language change
  const handleLanguageChange = useCallback(
    (value: string) => {
      updateAttributes({ language: value })
    },
    [updateAttributes]
  )

  // Handle copy code block content
  const handleCopy = useCallback(async () => {
    const codeText = props.node.textContent || ''
    try {
      await navigator.clipboard.writeText(codeText)
    } catch {
      // Clipboard may fail (e.g. non-secure context)
    }
  }, [props.node.textContent])

  const handleToggleView = useCallback(() => {
    setShowPreview((prev) => !prev)
  }, [])

  // Special view: render diagram preview with toggle to edit source
  if (isSpecialView && showPreview) {
    const SpecialComponent = SPECIAL_VIEW_COMPONENTS[language as keyof typeof SPECIAL_VIEW_COMPONENTS]
    const codeContent = node.textContent || ''

    return (
      <NodeViewWrapper className="code-block-wrapper">
        <div className="code-block-header">
          <span className="code-block-language-label">{language}</span>
          <div className="flex items-center gap-1">
            {isEditable && (
              <Tooltip content={t('common.edit')}>
                <Button size="icon-sm" variant="ghost" className="code-block-copy-btn" onClick={handleToggleView}>
                  <Code size={14} />
                </Button>
              </Tooltip>
            )}
            <Tooltip content={t('common.copy')}>
              <Button size="icon-sm" variant="ghost" className="code-block-copy-btn" onClick={handleCopy}>
                <Copy size={14} />
              </Button>
            </Tooltip>
          </div>
        </div>
        <div className="special-preview-wrapper">
          <SpecialComponent>{codeContent}</SpecialComponent>
        </div>
        <pre className={`language-${language}`} style={{ display: 'none' }}>
          <NodeViewContent<'code'> as="code" />
        </pre>
      </NodeViewWrapper>
    )
  }

  // Special view: source editing mode with toggle to preview
  if (isSpecialView && !showPreview) {
    return (
      <NodeViewWrapper className="code-block-wrapper">
        <div className="code-block-header">
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger size="sm" className="code-block-language-select min-w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {lang}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Tooltip content={t('common.preview')}>
              <Button size="icon-sm" variant="ghost" className="code-block-copy-btn" onClick={handleToggleView}>
                <Eye size={14} />
              </Button>
            </Tooltip>
            <Tooltip content={t('common.copy')}>
              <Button size="icon-sm" variant="ghost" className="code-block-copy-btn" onClick={handleCopy}>
                <Copy size={14} />
              </Button>
            </Tooltip>
          </div>
        </div>
        <pre className={`language-${language}`}>
          <NodeViewContent<'code'> as="code" />
        </pre>
      </NodeViewWrapper>
    )
  }

  // Normal code block: source code with language selector
  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div className="code-block-header">
        <Select value={language} onValueChange={handleLanguageChange}>
          <SelectTrigger size="sm" className="code-block-language-select min-w-[90px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languageOptions.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip content={t('common.copy')}>
          <Button size="icon-sm" variant="ghost" className="code-block-copy-btn" onClick={handleCopy}>
            <Copy size={14} />
          </Button>
        </Tooltip>
      </div>
      <pre className={`language-${language}`}>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

export const CodeBlockNodeReactRenderer = ReactNodeViewRenderer(CodeBlockNodeView)

export default CodeBlockNodeView
