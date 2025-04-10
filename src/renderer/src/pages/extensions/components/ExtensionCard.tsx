import { DeleteOutlined, InfoCircleOutlined, SettingOutlined } from '@ant-design/icons'
import CommonLogo from '@renderer/components/CommonLogo'
import { HStack, VStack } from '@renderer/components/Layout'
import { formatFileSize, getFirstCharacter } from '@renderer/utils'
import { Extension } from '@shared/config/types'
import { Button, List, Popconfirm, Switch, Tag, Tooltip, Typography } from 'antd'
import dayjs from 'dayjs'
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
            <CommonLogo shape="square" src={extension.icon} size={25} />
          ) : (
            <CommonLogo shape="square" size={25}>
              {getFirstCharacter(extension.name)}
            </CommonLogo>
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
                    onClick={() => window.api.extensions.openChromeStore({ loadExtensions: true })}
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
            <HStack gap={8} style={{ marginTop: 8 }}>
              <Tag color="blue">v{extension.version}</Tag>
              {extension.size && <Tag color="default">{formatFileSize(extension.size)}</Tag>}
              {extension.installDate && (
                <Tag color="default">
                  {t('extensions.installed_on', 'Installed on')} {dayjs(extension.installDate).format('YYYY-MM-DD')}
                </Tag>
              )}
            </HStack>
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
