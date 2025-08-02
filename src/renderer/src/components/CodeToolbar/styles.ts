import styled from 'styled-components'

export const ToolWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  color: var(--color-text-3);

  &:hover {
    background-color: var(--color-background-soft);
    .tool-icon {
      color: var(--color-text-1);
    }
  }

  &.active {
    color: var(--color-primary);
    .tool-icon {
      color: var(--color-primary);
    }
  }

  /* For Lucide icons */
  .tool-icon {
    width: 14px;
    height: 14px;
    color: var(--color-text-3);
  }
`
