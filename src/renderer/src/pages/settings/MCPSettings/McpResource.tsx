import { ColFlex, Flex } from '@cherrystudio/ui'
import type { MCPResource } from '@renderer/types'
import { Collapse, Descriptions, Empty, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

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
    <div className="mt-2 pt-2">
      <h3 className="mb-2 font-medium text-foreground-secondary text-sm">
        {t('settings.mcp.resources.availableResources') || 'Available Resources'}
      </h3>
      {resources.length > 0 ? (
        <Collapse bordered={false} ghost>
          {resources.map((resource) => (
            <Collapse.Panel
              key={resource.uri}
              header={
                <ColFlex className="w-full items-start">
                  <Flex className="w-full items-center">
                    <Typography.Text strong>{`${resource.name} (${resource.uri})`}</Typography.Text>
                  </Flex>
                  {resource.description && (
                    <Typography.Text type="secondary" style={{ fontSize: '13px', marginTop: 4 }}>
                      {resource.description.length > 100
                        ? `${resource.description.substring(0, 100)}...`
                        : resource.description}
                    </Typography.Text>
                  )}
                </ColFlex>
              }>
              <div className="select-text px-3">{renderResourceProperties(resource)}</div>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <Empty
          description={t('settings.mcp.resources.noResourcesAvailable') || 'No resources available'}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </div>
  )
}

export default MCPResourcesSection
