import { ColFlex, EmptyState, Flex, Tooltip } from '@cherrystudio/ui'
import type { MCPPrompt } from '@renderer/types'
import { Collapse, Descriptions, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

interface MCPPromptsSectionProps {
  prompts: MCPPrompt[]
}

const MCPPromptsSection = ({ prompts }: MCPPromptsSectionProps) => {
  const { t } = useTranslation()

  // Render prompt arguments
  const renderPromptArguments = (prompt: MCPPrompt) => {
    if (!prompt.arguments || prompt.arguments.length === 0) return null

    return (
      <div style={{ marginTop: 12 }}>
        <Typography.Title level={5}>{t('settings.mcp.tools.inputSchema.label')}:</Typography.Title>
        <Descriptions bordered size="small" column={1} style={{ marginTop: 8 }}>
          {prompt.arguments.map((arg, index) => (
            <Descriptions.Item
              key={index}
              label={
                <Flex className="gap-1">
                  <Typography.Text strong>{arg.name}</Typography.Text>
                  {arg.required && (
                    <Tooltip content={t('common.required_field')}>
                      <span style={{ color: '#f5222d' }}>*</span>
                    </Tooltip>
                  )}
                </Flex>
              }>
              <ColFlex className="gap-1">
                {arg.description && (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                    {arg.description}
                  </Typography.Paragraph>
                )}
              </ColFlex>
            </Descriptions.Item>
          ))}
        </Descriptions>
      </div>
    )
  }

  return (
    <div className="mt-2 pt-2">
      <h3 className="mb-2 font-medium text-foreground-secondary text-sm">
        {t('settings.mcp.prompts.availablePrompts')}
      </h3>
      {prompts.length > 0 ? (
        <Collapse bordered={false} ghost>
          {prompts.map((prompt) => (
            <Collapse.Panel
              key={prompt.id || prompt.name}
              header={
                <ColFlex className="items-start">
                  <Flex className="w-full items-center">
                    <Typography.Text strong>{prompt.name}</Typography.Text>
                  </Flex>
                  {prompt.description && (
                    <Typography.Text type="secondary" style={{ fontSize: '13px', marginTop: 4 }}>
                      {prompt.description}
                    </Typography.Text>
                  )}
                </ColFlex>
              }>
              <div className="select-text px-3">{renderPromptArguments(prompt)}</div>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <EmptyState compact preset="no-result" description={t('settings.mcp.prompts.noPromptsAvailable')} />
      )}
    </div>
  )
}

export default MCPPromptsSection
