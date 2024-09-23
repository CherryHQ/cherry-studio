import VisionIcon from '@renderer/components/Icons/VisionIcon'
import { getModelLogo, isVisionModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/model'
import { Model } from '@renderer/types'
import { Avatar, Dropdown, DropdownProps, MenuProps } from 'antd'
import { first, reverse, sortBy, upperFirst } from 'lodash'
import { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props extends DropdownProps {
  model?: Model
  onSelect: (model: Model) => void
}

const SelectModelDropdown: FC<Props & PropsWithChildren> = ({ children, model, onSelect, ...props }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()

  const items: MenuProps['items'] = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      key: p.id,
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      type: 'group',
      children: reverse(sortBy(p.models, 'name')).map((m) => ({
        key: getModelUniqId(m),
        label: (
          <div>
            {upperFirst(m?.name)} {isVisionModel(m) && <VisionIcon />}
          </div>
        ),
        icon: (
          <Avatar src={getModelLogo(m?.id || '')} size={24}>
            {first(m?.name)}
          </Avatar>
        ),
        onClick: () => m && onSelect(m)
      }))
    }))

  return (
    <DropdownMenu
      menu={{
        items,
        style: { maxHeight: '55vh', overflow: 'auto' },
        selectedKeys: model ? [getModelUniqId(model)] : []
      }}
      trigger={['click']}
      arrow
      placement="bottom"
      overlayClassName="chat-nav-dropdown"
      {...props}>
      {children}
    </DropdownMenu>
  )
}

const DropdownMenu = styled(Dropdown)`
  -webkit-app-region: none;
`

export default SelectModelDropdown
