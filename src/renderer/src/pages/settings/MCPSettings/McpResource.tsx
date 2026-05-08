import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  ColFlex,
  EmptyState,
  Flex
} from '@cherrystudio/ui'
import type { MCPResource } from '@renderer/types'
import { useTranslation } from 'react-i18next'

import { McpDetailItem, McpDetailList } from './McpDetailList'

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
      <McpDetailList>
        {resource.mimeType && (
          <McpDetailItem label={t('settings.mcp.resources.mimeType') || 'MIME Type'}>
            <Badge className="border-primary/30 bg-primary/10 text-primary">{resource.mimeType}</Badge>
          </McpDetailItem>
        )}
        {resource.size !== undefined && (
          <McpDetailItem label={t('settings.mcp.resources.size') || 'Size'}>
            {formatFileSize(resource.size)}
          </McpDetailItem>
        )}
        {resource.text && (
          <McpDetailItem label={t('settings.mcp.resources.text') || 'Text'}>
            <p className="m-0 whitespace-pre-wrap">{resource.text}</p>
          </McpDetailItem>
        )}
        {resource.blob && (
          <McpDetailItem label={t('settings.mcp.resources.blob') || 'Binary Data'}>
            {t('settings.mcp.resources.blobInvisible') || 'Binary data is not visible here.'}
          </McpDetailItem>
        )}
      </McpDetailList>
    )
  }

  return (
    <div className="mt-2 pt-2">
      {resources.length > 0 ? (
        <>
          <h3 className="mb-2 font-medium text-foreground-secondary text-sm">
            {t('settings.mcp.resources.availableResources') || 'Available Resources'}
          </h3>
          <Accordion type="multiple">
            {resources.map((resource) => (
              <AccordionItem key={resource.uri} value={resource.uri}>
                <AccordionTrigger className="py-3">
                  <ColFlex className="w-full min-w-0 items-start">
                    <Flex className="w-full min-w-0 items-center">
                      <span className="truncate font-medium text-foreground text-sm">{`${resource.name} (${resource.uri})`}</span>
                    </Flex>
                    {resource.description && (
                      <span className="mt-1 text-[13px] text-foreground-secondary leading-5">
                        {resource.description.length > 100
                          ? `${resource.description.substring(0, 100)}...`
                          : resource.description}
                      </span>
                    )}
                  </ColFlex>
                </AccordionTrigger>
                <AccordionContent className="select-text px-3">{renderResourceProperties(resource)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </>
      ) : (
        <EmptyState compact preset="no-result" description={t('settings.mcp.resources.noResourcesAvailable')} />
      )}
    </div>
  )
}

export default MCPResourcesSection
