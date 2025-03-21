import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { Input as AntdInput } from 'antd'
import { InputRef } from 'rc-input/lib/interface'
import React, { forwardRef, useRef } from 'react'
import styled from 'styled-components'

interface InputBarProps {
  text: string
  model: any
  referenceText: string
  placeholder: string
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const InputBar = forwardRef<HTMLDivElement, InputBarProps>(
  ({ text, model, placeholder, handleKeyDown, handleChange }, ref) => {
    const { generating } = useRuntime()
    const inputRef = useRef<InputRef>(null)
    if (!generating) {
      setTimeout(() => inputRef.current?.input?.focus(), 0)
    }
    return (
      <InputWrapper ref={ref}>
        <ModelAvatar model={model} size={30} />
        <Input
          value={text}
          placeholder={placeholder}
          variant="borderless"
          autoFocus
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          disabled={generating}
          ref={inputRef}
        />
      </InputWrapper>
    )
  }
)
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
