import { CloseOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons'
import { MCPServer, MCPTool, MCPToolParameterConfig } from '@renderer/types'
import { isEmpty } from '@renderer/utils'
import {
  Button,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  Input,
  InputNumber,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MCPToolsSectionProps {
  tools: MCPTool[]
  server: MCPServer
  onToggleTool: (tool: MCPTool, enabled: boolean) => void
  onUpdateToolConfig?: (toolName: string, config: MCPToolParameterConfig[]) => void
}

const MCPToolsSection = ({ tools, server, onToggleTool, onUpdateToolConfig }: MCPToolsSectionProps) => {
  const { t } = useTranslation()
  const [editingToolName, setEditingToolName] = useState<string | null>(null)
  const [editableToolParams, setEditableToolParams] = useState<MCPToolParameterConfig[]>([])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Effect to reset editable params when editingToolName changes or server config changes
  useEffect(() => {
    if (editingToolName) {
      const tool = tools.find((t) => t.name === editingToolName)
      if (tool) {
        initializeEditableParams(tool)
      } else {
        setEditingToolName(null)
      }
    } else {
      setEditableToolParams([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingToolName, server.customToolConfigs, tools])

  const isToolEnabled = (tool: MCPTool) => {
    return !server.disabledTools?.includes(tool.name)
  }

  const handleToggle = (tool: MCPTool, checked: boolean) => {
    onToggleTool(tool, checked)
  }

  const getToolConfig = (toolName: string): MCPToolParameterConfig[] => {
    const toolConfig = server.customToolConfigs?.find((config) => config.toolName === toolName)
    return toolConfig?.parameters || []
  }

  const getDefaultValueForType = (type: string): any => {
    switch (type) {
      case 'string':
        return ''
      case 'number':
        return 0
      case 'boolean':
        return false
      case 'array':
        return []
      case 'object':
        return {}
      default:
        return ''
    }
  }

  const initializeEditableParams = (tool: MCPTool) => {
    const currentConfig = getToolConfig(tool.name)
    const initialConfig: MCPToolParameterConfig[] = []
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([paramName, paramDef]: [string, any]) => {
        const existingConfig = currentConfig.find((c) => c.name === paramName)
        initialConfig.push({
          name: paramName,
          defaultValue: existingConfig?.defaultValue ?? getDefaultValueForType(paramDef.type),
          description: paramDef.description || ''
        })
      })
    }
    setEditableToolParams(initialConfig)
  }

  const handleEditToolParams = (tool: MCPTool) => {
    if (editingToolName === tool.name) {
      // If already editing this tool, cancel editing
      setEditingToolName(null)
      setEditableToolParams([])
      setHasUnsavedChanges(false)
    } else {
      setEditingToolName(tool.name)
      setHasUnsavedChanges(false)
      // initializeEditableParams will be called by the useEffect
    }
  }

  const handleSaveToolParams = (toolName: string) => {
    if (onUpdateToolConfig) {
      onUpdateToolConfig(toolName, editableToolParams)
    }
    setEditingToolName(null)
    setEditableToolParams([])
    setHasUnsavedChanges(false)
  }

  const handleCancelEditToolParams = () => {
    setEditingToolName(null)
    setEditableToolParams([])
    setHasUnsavedChanges(false)
  }

  const updateParameterConfig = (index: number, field: keyof MCPToolParameterConfig, value: any) => {
    const newConfig = [...editableToolParams]
    newConfig[index] = { ...newConfig[index], [field]: value }
    setEditableToolParams(newConfig)
    setHasUnsavedChanges(true)
  }

  const handleParameterBlur = (index: number, field: keyof MCPToolParameterConfig, value: any) => {
    updateParameterConfig(index, field, value)
  }

  const renderParameterInput = (param: MCPToolParameterConfig, index: number, paramDef: any) => {
    const { type } = paramDef

    switch (type) {
      case 'number':
        return (
          <InputNumber
            value={param.defaultValue}
            onChange={(value) => updateParameterConfig(index, 'defaultValue', value)}
            onBlur={(e) => {
              const value = e.target.value ? Number(e.target.value) : undefined
              handleParameterBlur(index, 'defaultValue', value)
            }}
            style={{ width: '100%' }}
            placeholder="Enter default number"
          />
        )
      case 'boolean':
        return (
          <Switch
            checked={param.defaultValue}
            onChange={(checked) => {
              updateParameterConfig(index, 'defaultValue', checked)
              // Switch 组件没有 onBlur，直接在 onChange 中处理
              handleParameterBlur(index, 'defaultValue', checked)
            }}
          />
        )
      case 'array':
        return (
          <Input.TextArea
            value={Array.isArray(param.defaultValue) ? param.defaultValue.join('\n') : ''}
            onChange={(e) => {
              const lines = e.target.value.split('\n').filter((line) => line.trim())
              updateParameterConfig(index, 'defaultValue', lines)
            }}
            onBlur={(e) => {
              const lines = e.target.value.split('\n').filter((line) => line.trim())
              handleParameterBlur(index, 'defaultValue', lines)
            }}
            placeholder="Enter array items (one per line)"
            rows={3}
          />
        )
      default: // 'string' and 'object' (as JSON string for simplicity here)
        if (type === 'object') {
          return (
            <Input.TextArea
              value={
                typeof param.defaultValue === 'object'
                  ? JSON.stringify(param.defaultValue, null, 2)
                  : param.defaultValue
              }
              onChange={(e) => {
                try {
                  const val = e.target.value
                  // Attempt to parse if it's meant to be an object, otherwise store as string
                  if (val.trim().startsWith('{') || val.trim().startsWith('[')) {
                    updateParameterConfig(index, 'defaultValue', JSON.parse(val))
                  } else {
                    updateParameterConfig(index, 'defaultValue', val)
                  }
                } catch (error) {
                  // If JSON is invalid while typing, keep the string value
                  updateParameterConfig(index, 'defaultValue', e.target.value)
                }
              }}
              onBlur={(e) => {
                try {
                  const val = e.target.value
                  if (val.trim().startsWith('{') || val.trim().startsWith('[')) {
                    handleParameterBlur(index, 'defaultValue', JSON.parse(val))
                  } else {
                    handleParameterBlur(index, 'defaultValue', val)
                  }
                } catch (error) {
                  // If JSON is invalid, keep the string value
                  handleParameterBlur(index, 'defaultValue', e.target.value)
                }
              }}
              placeholder="Enter default JSON object or string"
              rows={3}
            />
          )
        }
        return (
          <Input
            value={param.defaultValue}
            onChange={(e) => updateParameterConfig(index, 'defaultValue', e.target.value)}
            onBlur={(e) => handleParameterBlur(index, 'defaultValue', e.target.value)}
            placeholder="Enter default value"
          />
        )
    }
  }

  const renderToolProperties = (tool: MCPTool) => {
    if (!tool.inputSchema?.properties) return null

    const getTypeColor = (type: string) => {
      switch (type) {
        case 'string':
          return 'blue'
        case 'number':
          return 'green'
        case 'boolean':
          return 'purple'
        case 'object':
          return 'orange'
        case 'array':
          return 'cyan'
        default:
          return 'default'
      }
    }

    const toolConfig = getToolConfig(tool.name)
    const isEditingThisTool = editingToolName === tool.name

    return (
      <div style={{ marginTop: 12 }}>
        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t('settings.mcp.tools.inputSchema')}:
          </Typography.Title>
          <Tooltip title={t('settings.mcp.tools.configureDefaults')}>
            <Button
              type={isEditingThisTool ? 'primary' : 'text'}
              icon={<SettingOutlined />}
              size="small"
              onClick={() => handleEditToolParams(tool)}
            />
          </Tooltip>
        </Flex>
        <Descriptions bordered size="small" column={1} style={{ marginTop: 8 }}>
          {Object.entries(tool.inputSchema.properties).map(([key, prop]: [string, any]) => {
            const paramDefFromSchema = tool.inputSchema?.properties?.[key] as any
            const currentParamSetting = toolConfig.find((c) => c.name === key)
            const hasDefaultValue = !isEmpty(currentParamSetting?.defaultValue)

            const editableParam = isEditingThisTool ? editableToolParams.find((p) => p.name === key) : null

            return (
              <Descriptions.Item
                key={key}
                label={
                  <Flex gap={4} align="center">
                    <Typography.Text strong>{key}</Typography.Text>
                    {tool.inputSchema.required?.includes(key) && (
                      <Tag color="red" style={{ margin: 0 }}>
                        {t('common.required')}
                      </Tag>
                    )}
                    {prop.type && (
                      <Tag color={getTypeColor(prop.type)} style={{ margin: 0 }}>
                        {prop.type}
                      </Tag>
                    )}
                  </Flex>
                }>
                <Flex vertical gap={8}>
                  {prop.description && (
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: '13px' }}>
                      {prop.description}
                    </Typography.Paragraph>
                  )}

                  {isEditingThisTool && editableParam && paramDefFromSchema ? (
                    <Flex
                      align="center"
                      gap={8}
                      style={{
                        marginTop: 8,
                        border: '1px solid var(--color-border-secondary)',
                        borderRadius: 6,
                        backgroundColor: 'var(--color-background)'
                      }}>
                      <Typography.Text style={{ fontWeight: 500, marginBottom: 0, flexShrink: 0 }}>
                        {t('settings.mcp.tools.defaultValue')}:
                      </Typography.Text>
                      {renderParameterInput(
                        editableParam,
                        editableToolParams.findIndex((p) => p.name === key),
                        paramDefFromSchema
                      )}
                    </Flex>
                  ) : (
                    hasDefaultValue && (
                      <div style={{ marginTop: 4 }}>
                        <Typography.Text type="secondary">{t('settings.mcp.tools.defaultValue')}: </Typography.Text>
                        <Tag color="geekblue">{JSON.stringify(currentParamSetting?.defaultValue)}</Tag>
                      </div>
                    )
                  )}

                  {prop.enum && (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary">{t('common.allowed_values')}: </Typography.Text>
                      <Flex wrap="wrap" gap={4} style={{ marginTop: 4 }}>
                        {prop.enum.map((value: string, idx: number) => (
                          <Tag key={idx}>{value}</Tag>
                        ))}
                      </Flex>
                    </div>
                  )}
                </Flex>
              </Descriptions.Item>
            )
          })}
        </Descriptions>
        {isEditingThisTool && (
          <Flex justify="space-between" align="center" style={{ marginTop: 16 }}>
            <Flex align="center" gap={8}>
              {hasUnsavedChanges && (
                <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
                  {t('common.unsaved_changes')}
                </Typography.Text>
              )}
            </Flex>
            <Flex gap={8}>
              <Button icon={<CloseOutlined />} onClick={handleCancelEditToolParams}>
                {t('common.cancel')}
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={() => handleSaveToolParams(tool.name)}
                disabled={!hasUnsavedChanges}>
                {t('common.save')}
              </Button>
            </Flex>
          </Flex>
        )}
      </div>
    )
  }

  return (
    <Section>
      <SectionTitle>{t('settings.mcp.tools.availableTools')}</SectionTitle>
      {tools.length > 0 ? (
        <Collapse bordered={false} ghost accordion>
          {tools.map((tool) => (
            <Collapse.Panel
              key={tool.id}
              header={
                <Flex justify="space-between" align="center" style={{ width: '100%' }}>
                  <Flex vertical align="flex-start" style={{ flexGrow: 1, maxWidth: 'calc(100% - 60px)' }}>
                    <Flex align="center" style={{ width: '100%' }}>
                      <Typography.Text strong style={{ marginRight: 8 }}>
                        {tool.name}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                        ({tool.id})
                      </Typography.Text>
                      {server.customToolConfigs
                        ?.find((c) => c.toolName === tool.name)
                        ?.parameters.some((p) => !isEmpty(p.defaultValue)) && (
                        <Tooltip title={t('settings.mcp.tools.hasDefaultTooltip')}>
                          <Tag color="blue" style={{ marginLeft: 'auto', marginRight: 8, flexShrink: 0 }}>
                            {t('settings.mcp.tools.hasDefaults')}
                          </Tag>
                        </Tooltip>
                      )}
                    </Flex>
                    {tool.description && (
                      <Typography.Text
                        type="secondary"
                        style={{
                          fontSize: '13px',
                          marginTop: 4,
                          width: '100%',
                          whiteSpace: 'normal',
                          wordBreak: 'break-word'
                        }}>
                        {tool.description.length > 150 ? `${tool.description.substring(0, 150)}...` : tool.description}
                      </Typography.Text>
                    )}
                  </Flex>
                  <Space onClick={(e) => e.stopPropagation()} style={{ marginLeft: 10 }}>
                    <Switch
                      checked={isToolEnabled(tool)}
                      onChange={(checked) => {
                        handleToggle(tool, checked)
                      }}
                    />
                  </Space>
                </Flex>
              }>
              <SelectableContent
                onClick={(e) => e.stopPropagation() /* Prevent collapse toggle when clicking content */}>
                {renderToolProperties(tool)}
              </SelectableContent>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <Empty description={t('settings.mcp.tools.noToolsAvailable')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
  padding: 0 12px 12px 12px;
`

export default MCPToolsSection
