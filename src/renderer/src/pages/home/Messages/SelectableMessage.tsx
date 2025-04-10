import { Checkbox } from 'antd'
import { FC, ReactNode } from 'react'
import styled from 'styled-components'

interface SelectableMessageProps {
  children: ReactNode
  isMultiSelectMode: boolean
  isSelected: boolean
  onSelect: (selected: boolean) => void
  messageId: string
}

const SelectableMessage: FC<SelectableMessageProps> = ({ children, isMultiSelectMode, isSelected, onSelect }) => {
  return (
    <Container>
      {isMultiSelectMode && (
        <CheckboxWrapper>
          <Checkbox checked={isSelected} onChange={(e) => onSelect(e.target.checked)} />
        </CheckboxWrapper>
      )}
      <MessageContent isMultiSelectMode={isMultiSelectMode}>{children}</MessageContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  width: 100%;
  position: relative;
`

const CheckboxWrapper = styled.div`
  padding: 10px 0;
  padding-left: 20px;
  display: flex;
  align-items: flex-start;
`

const MessageContent = styled.div<{ isMultiSelectMode: boolean }>`
  flex: 1;
  ${(props) => props.isMultiSelectMode && 'margin-left: 8px;'}
`

export default SelectableMessage
