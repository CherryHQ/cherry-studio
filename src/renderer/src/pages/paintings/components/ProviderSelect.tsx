import { getProviderLogo } from '@renderer/config/providers'
import { getProviderNameById } from '@renderer/services/ProviderService'
import { Provider } from '@types'
import { Avatar, Select } from 'antd'
import React, { FC } from 'react'
import styled from 'styled-components'

type ProviderSelectProps = {
  provider: Provider
  options: string[]
  onChange: (value: string) => void
  style?: React.CSSProperties
}

const ProviderSelect: FC<ProviderSelectProps> = ({ provider, options, onChange, style }) => {
  const providerOptions = options.map((option) => {
    return {
      label: getProviderNameById(option),
      value: option
    }
  })

  return (
    <Select value={provider.id} onChange={onChange} style={style}>
      {providerOptions.map((provider) => (
        <Select.Option value={provider.value} key={provider.value}>
          <SelectOptionContainer>
            <ProviderLogo shape="square" src={getProviderLogo(provider.value || '')} size={16} />
            {provider.label}
          </SelectOptionContainer>
        </Select.Option>
      ))}
    </Select>
  )
}

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

const SelectOptionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export default ProviderSelect
