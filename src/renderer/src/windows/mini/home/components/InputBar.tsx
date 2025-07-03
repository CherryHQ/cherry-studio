import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { Assistant } from '@renderer/types'
import { Input as AntdInput } from 'antd'
import { InputRef } from 'rc-input/lib/interface'
import { TextAreaRef } from 'rc-textarea/lib/interface'
import React, { useRef } from 'react'
import styled from 'styled-components'

interface InputBarProps {
  text: string
  assistant: Assistant
  referenceText: string
  placeholder: string
  loading: boolean
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}

const InputBar = ({
  ref,
  text,
  assistant,
  placeholder,
  loading,
  handleKeyDown,
  handleChange
}: InputBarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const inputRef = useRef<TextAreaRef>(null)
  if (!loading) {
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  return (
    <InputWrapper ref={ref}>
      {assistant.model && <ModelAvatar model={assistant.model} size={30} />}
      <AntdInput.TextArea
        value={text}
        placeholder={placeholder}
        variant="borderless"
        autoFocus
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        ref={inputRef}
        autoSize={{ minRows: 1, maxRows: 4 }}
      />
    </InputWrapper>
  )
}
InputBar.displayName = 'InputBar'

const InputWrapper = styled.div`
  display: flex;
  margin-top: 10px;
  
  & > :first-child {
    margin-top: 4px;
  }
`

const Input = styled(AntdInput.TextArea)`
  background: none;
  border: none;
  -webkit-app-region: none;
  font-size: 18px;
  resize: none;
  margin-left: 8px;
  align-self: flex-start;
`

export default InputBar
