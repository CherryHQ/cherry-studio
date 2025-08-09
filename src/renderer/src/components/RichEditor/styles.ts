import styled from 'styled-components'

export const RichEditorWrapper = styled.div<{
  $minHeight?: number
  $maxHeight?: number
}>`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  overflow: hidden;

  ${({ $minHeight }) => $minHeight && `min-height: ${$minHeight}px;`}
  ${({ $maxHeight }) => $maxHeight && `max-height: ${$maxHeight}px;`}
`

export const ToolbarWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;

  &::-webkit-scrollbar-track {
    background: var(--color-background-soft);
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-3);
  }

  /* Firefox 滚动条样式 */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) var(--color-background-soft);
`

export const ToolbarButton = styled.button<{
  $active?: boolean
  $disabled?: boolean
}>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: ${({ $active }) => ($active ? 'var(--color-primary)' : 'transparent')};
  color: ${({ $active, $disabled }) =>
    $disabled ? 'var(--color-text-3)' : $active ? 'var(--color-white)' : 'var(--color-text)'};
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'pointer')};
  transition: all 0.2s ease;
  flex-shrink: 0; /* 防止按钮收缩 */

  &:hover:not(:disabled) {
    background: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-hover)')};
  }

  &:disabled {
    opacity: 0.5;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`

export const ToolbarDivider = styled.div`
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 4px;
  flex-shrink: 0; /* 防止分隔符收缩 */
`

export const EditorContent = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: auto; /* Allow horizontal scrolling to prevent drag handle from being cut off */

  .drag-handle {
    align-items: center;
    background: var(--color-background-soft);
    border-radius: 0.25rem;
    border: 1px solid var(--color-border);
    cursor: grab;
    display: flex;
    height: 1.5rem;
    justify-content: center;
    width: 1.5rem;
    position: relative; /* Ensure proper positioning */
    z-index: 10; /* Keep drag handle above other content */
    flex-shrink: 0; /* Prevent the drag handle from shrinking */

    &:hover {
      background: var(--color-hover);
    }

    svg {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--color-icon);
    }
  }

  /* Ensure the ProseMirror editor content doesn't override drag handle positioning */
  .ProseMirror {
    position: relative;
  }
`
