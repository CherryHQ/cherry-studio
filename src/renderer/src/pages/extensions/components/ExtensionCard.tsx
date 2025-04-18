import { DeleteOutlined, InfoCircleOutlined, SettingOutlined } from '@ant-design/icons'
import ExtensionIcon from '@renderer/components/Icons/ExtensionIcon'
import { HStack, VStack } from '@renderer/components/Layout'
import { getFirstCharacter } from '@renderer/utils'
import { Extension } from '@shared/config/types'
import { Button, List, Popconfirm, Switch, Tooltip, Typography } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text, Title } = Typography

interface ExtensionCardProps {
  extension: Extension
  onToggle: () => void
  onUninstall: () => void
}

const ExtensionCard: FC<ExtensionCardProps> = ({ extension, onToggle, onUninstall }) => {
  const { t } = useTranslation()

  return (
    <List.Item>
      <CardContainer>
        <HStack gap={16} style={{ alignItems: 'flex-start' }}>
          {extension.icon ? (
            <ExtensionIcon src={extension.icon} size={24} shape="square" />
          ) : (
            <ExtensionIcon shape="square" size={24}>
              {getFirstCharacter(extension.name)}
            </ExtensionIcon>
          )}
          <VStack flex={1} gap={4}>
            <HStack style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Title level={5} style={{ margin: 0 }}>
                {extension.name}
              </Title>
              <HStack gap={8}>
                <Switch checked={extension.enabled} onChange={onToggle} size="small" />
                <Tooltip title={t('extensions.settings', 'Extension settings')}>
                  <Button
                    type="text"
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={() => window.api.extensions.openChromeStore({ loadExtensions: true })} // TODO: 打开扩展详情页
                  />
                </Tooltip>
                <Popconfirm
                  title={t('extensions.confirm_uninstall', 'Are you sure you want to uninstall this extension?')}
                  onConfirm={onUninstall}
                  okText={t('common.yes', 'Yes')}
                  cancelText={t('common.no', 'No')}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </HStack>
            </HStack>
            <Text type="secondary">{extension.description}</Text>
            {extension.permissions && extension.permissions.length > 0 && (
              <HStack gap={4} style={{ alignItems: 'center', marginTop: 8 }}>
                <InfoCircleOutlined style={{ color: 'var(--color-warning)' }} />
                <Text type="secondary">
                  {t('extensions.permissions', 'Permissions')}: {extension.permissions.join(', ')}
                </Text>
              </HStack>
            )}
          </VStack>
        </HStack>
      </CardContainer>
    </List.Item>
  )
}

const CardContainer = styled.div`
  width: 100%;
  padding: 8px;
`

export default ExtensionCard
