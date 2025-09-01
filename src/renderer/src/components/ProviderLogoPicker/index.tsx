import { SearchOutlined } from '@ant-design/icons'
import { PROVIDER_LOGO_MAP } from '@renderer/config/providers'
import { useProviderAvatar } from '@renderer/hooks/useProviderLogo'
import { getProviderLabel } from '@renderer/i18n/label'
import { useAppSelector } from '@renderer/store'
import { isSystemProvider } from '@renderer/types'
import { Input, Tooltip } from 'antd'
import { FC, useMemo, useState } from 'react'
import styled from 'styled-components'

interface Props {
  onProviderClick: (providerId: string) => void
}

// 用于选择内置头像的提供商Logo选择器组件
const ProviderLogoPicker: FC<Props> = ({ onProviderClick }) => {
  const [searchText, setSearchText] = useState('')
  const providers = useAppSelector((state) => state.llm.providers)

  const { ProviderAvatar } = useProviderAvatar()
  const filteredProviders = useMemo(() => {
    const _providers = providers.filter(isSystemProvider).map((p) => ({
      id: p.id,
      name: p.name,
      label: getProviderLabel(p.id),
      logo: PROVIDER_LOGO_MAP[p.id]
    }))
    if (!searchText) return _providers

    const searchLower = searchText.toLowerCase()
    return _providers.filter((p) => `${p.name} ${p.id} ${p.label}`.toLowerCase().includes(searchLower))
  }, [providers, searchText])

  const handleProviderClick = (event: React.MouseEvent, providerId: string) => {
    event.stopPropagation()
    onProviderClick(providerId)
  }

  return (
    <Container>
      <SearchContainer>
        <Input
          placeholder="search"
          prefix={<SearchOutlined style={{ color: 'var(--color-text-3)' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          size="small"
          allowClear
          style={{
            borderRadius: 'var(--list-item-border-radius)',
            background: 'var(--color-background-soft)'
          }}
        />
      </SearchContainer>
      <LogoGrid>
        {filteredProviders.map(({ id, label }) => (
          <Tooltip key={id} title={label} placement="top" mouseLeaveDelay={0}>
            <LogoItem onClick={(e) => handleProviderClick(e, id)}>
              <ProviderAvatar pid={id} size={32} />
            </LogoItem>
          </Tooltip>
        ))}
      </LogoGrid>
    </Container>
  )
}

const Container = styled.div`
  width: 350px;
  max-height: 300px;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--color-background);
  border-radius: 8px;
`

const SearchContainer = styled.div`
  margin-bottom: 12px;
`

const LogoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  overflow-y: auto;
  flex: 1;
  padding: 4px;
`

const LogoItem = styled.div`
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s ease;
  background: var(--color-background-soft);
  border: 0.5px solid var(--color-border);

  &:hover {
    background: var(--color-background-mute);
    transform: scale(1.05);
    border-color: var(--color-primary);
  }

  img {
    width: 32px;
    height: 32px;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
  }
`

export default ProviderLogoPicker
