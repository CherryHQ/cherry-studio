import { MCPResource } from '@renderer/types'
import { Collapse, Descriptions, Empty, Flex, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MCPResourcesSectionProps {
  resources: MCPResource[]
}

const MCPResourcesSection = ({ resources }: MCPResourcesSectionProps) => {
  const { t } = useTranslation()

  // Format file size to human-readable format
  const formatFileSize = (size?: number) => {
    if (size === undefined) return 'Unknown size'

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let formattedSize = size
    let unitIndex = 0

    while (formattedSize >= 1024 && unitIndex < units.length - 1) {
      formattedSize /= 1024
      unitIndex++
    }

    return `${formattedSize.toFixed(2)} ${units[unitIndex]}`
  }

  // Render resource properties
  const renderResourceProperties = (resource: MCPResource) => {
    return (
      <Descriptions column={1} size="small" bordered>
        {resource.mimeType && (
          <Descriptions.Item label={t('settings.mcp.resources.mimeType') || 'MIME Type'}>
            <Tag color="blue">{resource.mimeType}</Tag>
          </Descriptions.Item>
        )}
        {resource.size !== undefined && (
          <Descriptions.Item label={t('settings.mcp.resources.size') || 'Size'}>
            {formatFileSize(resource.size)}
          </Descriptions.Item>
        )}
        {resource.text && (
          <Descriptions.Item label={t('settings.mcp.resources.text') || 'Text'}>{resource.text}</Descriptions.Item>
        )}
        {resource.blob && (
          <Descriptions.Item label={t('settings.mcp.resources.blob') || 'Binary Data'}>
            {t('settings.mcp.resources.blobInvisible') || 'Binary data is not visible here.'}
          </Descriptions.Item>
        )}
      </Descriptions>
    )
  }

  return (
    <Section>
      <SectionTitle>{t('settings.mcp.resources.availableResources') || 'Available Resources'}</SectionTitle>
      {resources.length > 0 ? (
        <Collapse bordered={false} ghost>
          {resources.map((resource) => (
            <Collapse.Panel
              key={resource.uri}
              header={
                <Flex vertical align="flex-start" style={{ width: '100%' }}>
                  <Flex align="center" style={{ width: '100%' }}>
                    <Typography.Text strong>{`${resource.name} (${resource.uri})`}</Typography.Text>
                  </Flex>
                  {resource.description && (
                    <Typography.Text type="secondary" style={{ fontSize: '13px', marginTop: 4 }}>
                      {resource.description.length > 100
                        ? `${resource.description.substring(0, 100)}...`
                        : resource.description}
                    </Typography.Text>
                  )}
                </Flex>
              }>
              <SelectableContent>{renderResourceProperties(resource)}</SelectableContent>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <Empty
          description={t('settings.mcp.resources.noResourcesAvailable') || 'No resources available'}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </Section>
  )
}

const Section = styled.div`
  margin-top: 8px;
  padding-top: 8px;
`

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  color: var(--color-text-secondary);
`

const SelectableContent = styled.div`
  user-select: text;
  padding: 0 12px;
`

export default MCPResourcesSection
