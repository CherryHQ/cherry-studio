import { cn } from '@renderer/utils'
import {
  type ButtonHTMLAttributes,
  createElement,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
  useInsertionEffect
} from 'react'

const STYLE_ID = 'cherry-rich-editor-style-helpers'

const STYLE_CONTENT = `
.RichEditorWrapper {
  display: flex;
  flex-direction: column;
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  overflow-y: hidden;
}

.RichEditorWrapper .ProseMirror table,
.RichEditorWrapper .tiptap table {
  table-layout: auto !important;
}

.RichEditorWrapper .ProseMirror table th,
.RichEditorWrapper .ProseMirror table td,
.RichEditorWrapper .tiptap th,
.RichEditorWrapper .tiptap td {
  white-space: normal !important;
  word-wrap: break-word !important;
  word-break: break-word !important;
  overflow-wrap: break-word !important;
  overflow: visible !important;
  text-overflow: clip !important;
}

.RichEditorWrapper .ProseMirror table th > *,
.RichEditorWrapper .ProseMirror table td > *,
.RichEditorWrapper .tiptap td > *,
.RichEditorWrapper .tiptap th > * {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}

.ToolbarWrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-subtle);
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) var(--color-background-subtle);
}

.ToolbarWrapper::-webkit-scrollbar-track {
  background: var(--color-background-subtle);
}

.ToolbarWrapper::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.ToolbarWrapper::-webkit-scrollbar-thumb:hover {
  background: var(--color-foreground-muted);
}

.ToolbarButton {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.ToolbarButton:hover:not(:disabled) {
  background: var(--color-accent);
}

.ToolbarButton.is-active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.ToolbarButton:disabled,
.ToolbarButton.is-disabled {
  opacity: 0.5;
}

.ToolbarButton:disabled {
  cursor: not-allowed;
}

.ToolbarButton svg {
  width: 16px;
  height: 16px;
}

.ToolbarDivider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 4px;
  flex-shrink: 0;
}

.RichEditorContent {
  flex: 1;
  min-height: 0;
  position: relative;
}

.RichEditorContent .plus-button,
.RichEditorContent .drag-handle {
  align-items: center;
  border-radius: 0.25rem;
  cursor: grab;
  display: flex;
  height: 1.5rem;
  justify-content: center;
  z-index: 10;
  flex-shrink: 0;
}

.RichEditorContent .plus-button:hover,
.RichEditorContent .drag-handle:hover {
  background: var(--color-accent);
}

.RichEditorContent .plus-button svg,
.RichEditorContent .drag-handle svg {
  width: 1.25rem;
  height: 1.25rem;
  color: var(--color-icon);
}

.RichEditorContent .plus-button {
  width: 1.5rem;
  cursor: pointer;
  transform: translateX(calc(-1 * 1.5rem));
}

.RichEditorContent .drag-handle {
  width: 1rem;
  transform: translateX(-0.5rem) !important;
}

.RichEditorContent .ProseMirror {
  position: relative;
  min-height: 100%;
}

.RichEditorContent .ProseMirror:not([contenteditable='true']) {
  user-select: text;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
  cursor: text;
}

.RichEditorContent .ProseMirror:not([contenteditable='true']) * {
  user-select: text;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
}

.RichEditorContent .ProseMirror .rich-editor-link {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.RichEditorContent .ProseMirror .rich-editor-link:hover {
  text-decoration-thickness: 2px;
  background-color: var(--color-accent);
  padding: 1px 2px;
  margin: -1px -2px;
  border-radius: 3px;
}

.TableOfContentsWrapper .table-of-contents {
  display: flex;
  flex-direction: column;
  font-size: 0.86rem;
  gap: 0.1rem;
  overflow: auto;
  text-decoration: none;
}

.TableOfContentsWrapper .table-of-contents > div {
  border-radius: 0.25rem;
  padding-left: calc(0.4rem * (var(--level, 1) - 1));
  transition: all 0.2s cubic-bezier(0.65, 0.05, 0.36, 1);
}

.TableOfContentsWrapper .table-of-contents > div:hover {
  background-color: var(--gray-2);
}

.TableOfContentsWrapper .table-of-contents .empty-state {
  color: var(--gray-5);
  user-select: none;
}

.TableOfContentsWrapper .table-of-contents .is-active a {
  color: var(--purple);
}

.TableOfContentsWrapper .table-of-contents .is-scrolled-over a {
  color: var(--gray-5);
}

.TableOfContentsWrapper .table-of-contents a {
  color: var(--black);
  display: flex;
  gap: 0.25rem;
  text-decoration: none;
}

.TableOfContentsWrapper .table-of-contents a::before {
  content: attr(data-item-index) '.';
}

.TableOfContentsWrapper .toc-item {
  margin-left: 0.25rem;
  margin-bottom: 0.25rem;
}

.TableOfContentsWrapper .toc-item a {
  display: block;
  padding: 0.25rem 0.5rem;
  color: var(--color-foreground-secondary);
  text-decoration: none;
  border-radius: 4px;
  font-size: 0.9rem;
  line-height: 1.4;
  transition: all 0.2s ease;
}

.TableOfContentsWrapper .toc-item a:hover {
  background: var(--color-accent);
  color: var(--color-foreground);
}

.TableOfContentsWrapper .toc-item.is-active a {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 500;
}

.TableOfContentsWrapper .toc-item.is-scrolled-over a {
  opacity: 0.6;
}

.TableOfContentsWrapper .toc-empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--color-foreground-muted);
}

.TableOfContentsWrapper .toc-empty-state p {
  margin: 0;
  font-style: italic;
}

.ToCDock {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 26px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 4px;
  pointer-events: auto;
}

.ToCDock .toc-rail:hover ~ .toc-panel,
.ToCDock .toc-panel:hover {
  opacity: 1;
  visibility: visible;
  transform: translateX(0);
  pointer-events: auto;
}

.ToCDock .toc-rail:hover {
  opacity: 1;
}

.ToCDock .toc-rail {
  pointer-events: auto;
  width: 18px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  opacity: 0.6;
  transition: opacity 0.2s ease;
  overflow: hidden;
}

.ToCDock .toc-rail-button {
  appearance: none;
  border: none;
  padding: 0;
  background: var(--color-border, var(--color-border));
  height: 4px;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.8;
  width: 12px;
  display: block;
  flex-shrink: 0;
  transition:
    background 0.2s ease,
    opacity 0.2s ease,
    transform 0.1s ease;
}

.ToCDock .toc-rail-button:hover {
  background: var(--color-foreground);
  opacity: 1;
  transform: scaleX(1.05);
}

.ToCDock .toc-rail-button.active {
  background: var(--color-foreground);
  opacity: 1;
}

.ToCDock .toc-rail-button.scrolled-over {
  background: var(--color-border);
  opacity: 0.9;
}

.ToCDock .toc-rail-button.level-1 {
  width: 12px;
}

.ToCDock .toc-rail-button.level-2 {
  width: 10px;
}

.ToCDock .toc-rail-button.level-3 {
  width: 8px;
}

.ToCDock .toc-rail-button.level-4 {
  width: 6px;
}

.ToCDock .toc-rail-button.level-5 {
  width: 5px;
}

.ToCDock .toc-rail-button.level-6 {
  width: 4px;
}

.ToCDock .toc-panel {
  pointer-events: none;
  position: absolute;
  right: 8px;
  top: 55px;
  bottom: 8px;
  width: auto;
  max-width: 360px;
  min-width: 220px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 8px 8px 0;
  padding-left: 0;
  overflow: auto;
  opacity: 0;
  visibility: hidden;
  transform: translateX(8px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease,
    visibility 0.15s ease;
  backdrop-filter: blur(6px);
  z-index: 40;
}
`

type DivProps = HTMLAttributes<HTMLDivElement>

type RichEditorWrapperProps = DivProps & {
  $minHeight?: number
  $maxHeight?: number
  $isFullWidth?: boolean
  $fontFamily?: 'default' | 'serif'
  $fontSize?: number
}

type ToolbarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  $active?: boolean
  $disabled?: boolean
}

const useRichEditorStyleSheet = () => {
  useInsertionEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
      return
    }

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLE_CONTENT
    document.head.appendChild(style)
  }, [])
}

const createDivComponent = (displayName: string, baseClassName: string) => {
  const Component = ({ ref, className, ...props }: DivProps & { ref?: Ref<HTMLDivElement> }) => {
    useRichEditorStyleSheet()
    return createElement('div', { ...props, ref, className: cn(baseClassName, className) })
  }
  Component.displayName = displayName
  return Component
}

export const RichEditorWrapper = ({
  ref,
  $minHeight,
  $maxHeight,
  $isFullWidth,
  $fontFamily,
  $fontSize,
  className,
  style,
  ...props
}: RichEditorWrapperProps & { ref?: Ref<HTMLDivElement> }) => {
  useRichEditorStyleSheet()

  const dynamicStyle: CSSProperties & Record<string, string | number | undefined> = {
    width: $isFullWidth ? '100%' : '60%',
    margin: $isFullWidth ? '0' : '0 auto',
    fontFamily: $fontFamily === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
    minHeight: $minHeight ? `${$minHeight}px` : undefined,
    maxHeight: $maxHeight ? `${$maxHeight}px` : undefined,
    '--editor-font-size': $fontSize ? `${$fontSize}px` : undefined,
    ...style
  }

  return createElement('div', {
    ...props,
    ref,
    className: cn('RichEditorWrapper', className),
    style: dynamicStyle
  })
}
RichEditorWrapper.displayName = 'RichEditorWrapper'

export const ToolbarWrapper = createDivComponent('ToolbarWrapper', 'ToolbarWrapper')

export const ToolbarButton = ({
  ref,
  $active,
  $disabled,
  className,
  disabled,
  ...props
}: ToolbarButtonProps & { ref?: Ref<HTMLButtonElement> }) => {
  useRichEditorStyleSheet()
  return createElement('button', {
    ...props,
    ref,
    disabled,
    className: cn('ToolbarButton', $active && 'is-active', $disabled && 'is-disabled', className)
  })
}
ToolbarButton.displayName = 'ToolbarButton'

export const ToolbarDivider = createDivComponent('ToolbarDivider', 'ToolbarDivider')

export const EditorContent = createDivComponent('EditorContent', 'RichEditorContent')

export const TableOfContentsWrapper = createDivComponent('TableOfContentsWrapper', 'TableOfContentsWrapper')

export const ToCDock = createDivComponent('ToCDock', 'ToCDock')
