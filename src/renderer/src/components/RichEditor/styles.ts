import styled from 'styled-components'

export const RichEditorWrapper = styled.div<{
  $minHeight?: number
  $maxHeight?: number
  $isFullWidth?: boolean
  $fontFamily?: 'default' | 'serif'
  $fontSize?: number
}>`
  display: flex;
  flex-direction: column;
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  overflow-y: hidden;
  width: ${({ $isFullWidth }) => ($isFullWidth ? '100%' : '60%')};
  margin: ${({ $isFullWidth }) => ($isFullWidth ? '0' : '0 auto')};
  font-family: ${({ $fontFamily }) => ($fontFamily === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)')};
  ${({ $fontSize }) => $fontSize && `--editor-font-size: ${$fontSize}px;`}

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
  background: transparent;
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'pointer')};
  transition: all 0.2s ease;
  flex-shrink: 0; /* 防止按钮收缩 */

  &:hover:not(:disabled) {
    background: var(--color-hover);
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
  /* overflow handled by Scrollbar wrapper */
  position: relative; /* keep internal elements positioned, but ToC is now sibling */

  .plus-button,
  .drag-handle {
    align-items: center;
    border-radius: 0.25rem;
    cursor: grab;
    display: flex;
    height: 1.5rem;
    justify-content: center;
    z-index: 10;
    flex-shrink: 0;

    &:hover {
      background: var(--color-hover);
    }

    svg {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--color-icon);
    }
  }

  .plus-button {
    width: 1.5rem;
    cursor: pointer;
    transform: translateX(calc(-1 * 1.5rem));
  }

  .drag-handle {
    width: 1rem;
    transform: translateX(-0.5rem) !important;
  }

  /* Ensure the ProseMirror editor content doesn't override drag handle positioning */
  .ProseMirror {
    position: relative;
    height: 100%;

    /* Allow text selection when not editable */
    &:not([contenteditable='true']) {
      user-select: text;
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
      cursor: text;

      /* Ensure all child elements allow text selection */
      * {
        user-select: text;
        -webkit-user-select: text;
        -moz-user-select: text;
        -ms-user-select: text;
      }
    }

    /* Enhanced link styles */
    .rich-editor-link {
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        text-decoration-thickness: 2px;
        background-color: var(--color-hover);
        padding: 1px 2px;
        margin: -1px -2px;
        border-radius: 3px;
      }
    }
  }
`

export const TableOfContentsWrapper = styled.div`
  .table-of-contents {
    display: flex;
    flex-direction: column;
    font-size: 0.86rem;
    gap: 0.1rem; /* tighter spacing between items */
    overflow: auto;
    text-decoration: none;

    > div {
      border-radius: 0.25rem;
      padding-left: calc(0.4rem * (var(--level, 1) - 1));
      transition: all 0.2s cubic-bezier(0.65, 0.05, 0.36, 1);

      &:hover {
        background-color: var(--gray-2);
      }
    }

    .empty-state {
      color: var(--gray-5);
      user-select: none;
    }

    .is-active a {
      color: var(--purple);
    }

    .is-scrolled-over a {
      color: var(--gray-5);
    }

    a {
      color: var(--black);
      display: flex;
      gap: 0.25rem;
      text-decoration: none;

      &::before {
        content: attr(data-item-index) '.';
      }
    }
  }

  .toc-item {
    margin-left: 0.25rem;
    margin-bottom: 0.25rem;

    a {
      display: block;
      padding: 0.25rem 0.5rem;
      color: var(--color-text-2);
      text-decoration: none;
      border-radius: 4px;
      font-size: 0.9rem;
      line-height: 1.4;
      transition: all 0.2s ease;

      &:hover {
        background: var(--color-hover);
        color: var(--color-text);
      }
    }

    &.is-active a {
      background: var(--color-primary-soft);
      color: var(--color-primary);
      font-weight: 500;
    }

    &.is-scrolled-over a {
      opacity: 0.6;
    }
  }

  .toc-empty-state {
    text-align: center;
    padding: 2rem 1rem;
    color: var(--color-text-3);

    p {
      margin: 0;
      font-style: italic;
    }
  }
`

export const ToCDock = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0; /* dock fixed to wrapper, not editor scroll */
  width: 26px; /* narrow by default; panel will overlay the rail */
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 4px;
  pointer-events: auto; /* allow interacting with rail/panel */

  /* Show panel when hovering anywhere within the dock */
  .toc-rail:hover ~ .toc-panel,
  .toc-panel:hover {
    opacity: 1;
    visibility: visible;
    transform: translateX(0);
    pointer-events: auto;
  }
  .toc-rail:hover {
    opacity: 1;
  }

  .toc-rail {
    pointer-events: auto; /* clickable */
    width: 18px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center; /* dense and centered */
    align-items: center;
    gap: 4px;
    opacity: 0.6;
    transition: opacity 0.2s ease;
    overflow: hidden; /* prevent overflow */
  }

  .toc-rail-button {
    appearance: none;
    border: none;
    padding: 0;
    background: var(--color-gray-3, var(--color-border));
    height: 4px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.8;
    width: 12px; /* default for level 1 */
    display: block;
    flex-shrink: 0;
    transition:
      background 0.2s ease,
      opacity 0.2s ease,
      transform 0.1s ease;

    &:hover {
      background: var(--color-text);
      opacity: 1;
      transform: scaleX(1.05);
    }

    &.active {
      background: var(--color-text);
      opacity: 1;
    }

    &.scrolled-over {
      background: var(--color-gray-3);
      opacity: 0.9;
    }

    &.level-1 {
      width: 12px;
    }
    &.level-2 {
      width: 10px;
    }
    &.level-3 {
      width: 8px;
    }
    &.level-4 {
      width: 6px;
    }
    &.level-5 {
      width: 5px;
    }
    &.level-6 {
      width: 4px;
    }
  }

  .toc-panel {
    pointer-events: none; /* enabled on hover */
    position: absolute;
    right: 8px; /* cover the rail */
    top: 55px; /* insets within wrapper */
    bottom: 8px; /* bound to wrapper height, not editor scroll */
    width: auto;
    max-width: 360px; /* capped width */
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
