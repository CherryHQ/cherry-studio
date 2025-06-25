import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { Assistant } from '@renderer/types'
import { Input as AntdInput } from 'antd'
import { InputRef } from 'rc-input/lib/interface'
import React, { useRef } from 'react'
import styled from 'styled-components'

interface InputBarProps {
  text: string
  assistant: Assistant
  referenceText: string
  placeholder: string
  loading: boolean
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
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
  const inputRef = useRef<InputRef>(null)
  if (!loading) {
    setTimeout(() => inputRef.current?.input?.focus(), 0)
  }
  return (
    <InputWrapper ref={ref}>
      {assistant.model && <ModelAvatar model={assistant.model} size={30} />}
      <Input
        value={text}
        placeholder={placeholder}
        variant="borderless"
        autoFocus
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        ref={inputRef}
      />
    </InputWrapper>
  )
}
InputBar.displayName = 'InputBar'

const InputWrapper = styled.div`
  display: flex;
  align-items: center;
  margin-top: 10px;
`

const Input = styled(AntdInput)`
  background: none;
  border: none;
  -webkit-app-region: none;
  font-size: 18px;
`

export default InputBar
