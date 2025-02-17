import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { Input as AntdInput } from 'antd'
import React, { FC } from 'react'
import styled from 'styled-components'

interface InputBarProps {
  text: string
  model: any
  referenceText: string
  placeholder: string
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const InputBar: FC<InputBarProps> = ({ text, model, placeholder, handleKeyDown, handleChange }) => {
  const { generating } = useRuntime()
  return (
    <InputWrapper>
      <ModelAvatar model={model} size={30} />
      <Input
        value={text}
        placeholder={placeholder}
        bordered={false}
        autoFocus
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        disabled={generating}
      />
    </InputWrapper>
  )
}

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
