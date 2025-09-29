import { ColFlex, Flex } from '@cherrystudio/ui'
import { Tooltip } from '@cherrystudio/ui'
import type { MCPPrompt } from '@renderer/types'
import { Collapse, Descriptions, Empty, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
                    <Tooltip placement="top" content="Required field">
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
    <Section>
      <SectionTitle>{t('settings.mcp.prompts.availablePrompts')}</SectionTitle>
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
              <SelectableContent>{renderPromptArguments(prompt)}</SelectableContent>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <Empty description={t('settings.mcp.prompts.noPromptsAvailable')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
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

export default MCPPromptsSection
