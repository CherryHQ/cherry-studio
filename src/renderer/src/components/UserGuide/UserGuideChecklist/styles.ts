import styled from 'styled-components'

export const ContentContainer = styled.div`
  width: 280px;
  padding: 12px 0;
`

export const ChecklistHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0 16px;
`

export const TitleSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

export const ChecklistTitle = styled.h3`
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
  line-height: 16px;
`

export const ChecklistSubtitle = styled.p`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2);
  margin: 0;
  line-height: 14px;
`

export const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-2);
  transition: all 0.2s ease;
  flex-shrink: 0;
  padding: 0;

  &:hover {
    background: var(--color-background-mute);
    color: var(--color-text);
  }
`

export const Separator = styled.div`
  width: 100%;
  height: 1px;
  background: var(--color-border);
  margin: 12px 0;
`

export const TaskList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 16px;
`

export const TaskItemContainer = styled.div<{ $completed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  background: var(--color-white);
  cursor: ${(props) => (props.$completed ? 'default' : 'pointer')};
  transition: all 0.2s ease;

  body[theme-mode='dark'] & {
    background: var(--color-background-soft);
  }

  &:hover {
    ${(props) =>
      !props.$completed &&
      `
      background: var(--color-background-mute);
    `}
  }
`

export const Checkbox = styled.div<{ $checked?: boolean }>`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid ${(props) => (props.$checked ? '#3cd45a' : 'var(--color-border)')};
  background: ${(props) => (props.$checked ? '#3cd45a' : 'var(--color-background)')};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s ease;
`

export const TaskText = styled.span<{ $completed?: boolean }>`
  font-size: 13px;
  font-weight: 500;
  color: ${(props) => (props.$completed ? 'var(--color-text-3)' : 'var(--color-text)')};
  text-decoration: ${(props) => (props.$completed ? 'line-through' : 'none')};
  line-height: 15px;
`

export const ProgressText = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
  margin-top: 12px;
  text-align: center;
  padding: 0 16px;
`
