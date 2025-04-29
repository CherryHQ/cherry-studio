import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { Input as AntdInput } from 'antd'
import { InputRef } from 'rc-input/lib/interface'
import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'

interface InputBarProps {
  text: string
  model: any
  referenceText: string
  placeholder: string
  disabled?: boolean
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const InputBar = ({
  ref,
  text,
  model,
  placeholder,
  handleKeyDown,
  handleChange,
  disabled = false
}: InputBarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const inputRef = useRef<InputRef>(null)

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus()
    }
  }, [disabled])

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
        disabled={disabled}
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
