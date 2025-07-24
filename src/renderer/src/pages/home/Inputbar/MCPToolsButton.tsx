import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { EventEmitter } from '@renderer/services/EventService'
import { Assistant, MCPPrompt, MCPResource, MCPServer } from '@renderer/types'
import { Form, Input, Tooltip } from 'antd'
import { CircleX, Plus, SquareTerminal } from 'lucide-react'
import React, { FC, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface MCPToolsButtonRef {
  openQuickPanel: () => void
  openPromptList: () => void
  openResourcesList: () => void
}

interface Props {
  assistant: Assistant
  ref?: React.RefObject<MCPToolsButtonRef | null>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  ToolbarButton: any
}

// 添加类型定义
interface PromptArgument {
  name: string
  description?: string
  required?: boolean
}

interface MCPPromptWithArgs extends MCPPrompt {
  arguments?: PromptArgument[]
}

interface ResourceData {
  blob?: string
  mimeType?: string
  name?: string
  text?: string
  uri?: string
}

// 提取到组件外的工具函数
const extractPromptContent = (response: any): string | null => {
  // Handle string response (backward compatibility)
  if (typeof response === 'string') {
    return response
  }

  // Handle GetMCPPromptResponse format
  if (response && Array.isArray(response.messages)) {
    let formattedContent = ''

    for (const message of response.messages) {
      if (!message.content) continue

      // Add role prefix if available
      const rolePrefix = message.role ? `**${message.role.charAt(0).toUpperCase() + message.role.slice(1)}:** ` : ''

      // Process different content types
      switch (message.content.type) {
        case 'text':
          formattedContent += `${rolePrefix}${message.content.text}\n\n`
          break

        case 'image':
          if (message.content.data && message.content.mimeType) {
            if (rolePrefix) {
              formattedContent += `${rolePrefix}\n`
            }
            formattedContent += `![Image](data:${message.content.mimeType};base64,${message.content.data})\n\n`
          }
          break

        case 'audio':
          formattedContent += `${rolePrefix}[Audio content available]\n\n`
          break

        case 'resource':
          if (message.content.text) {
            formattedContent += `${rolePrefix}${message.content.text}\n\n`
          } else {
            formattedContent += `${rolePrefix}[Resource content available]\n\n`
          }
          break

        default:
          if (message.content.text) {
            formattedContent += `${rolePrefix}${message.content.text}\n\n`
          }
      }
    }

    return formattedContent.trim()
  }

  // Fallback handling for single message format
  if (response && response.messages && response.messages.length > 0) {
    const message = response.messages[0]
    if (message.content && message.content.text) {
      const rolePrefix = message.role ? `**${message.role.charAt(0).toUpperCase() + message.role.slice(1)}:** ` : ''
      return `${rolePrefix}${message.content.text}`
    }
  }

  return null
}

const MCPToolsButton: FC<Props> = ({ ref, setInputValue, resizeTextArea, ToolbarButton, ...props }) => {
  const { activedMcpServers } = useMCPServers()
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const { updateAssistant, assistant } = useAssistant(props.assistant.id)

  // 使用 useRef 存储不需要触发重渲染的值
  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const mcpServers = useMemo(() => assistant.mcpServers || [], [assistant.mcpServers])
  const assistantMcpServers = useMemo(
    () => activedMcpServers.filter((server) => mcpServers.some((s) => s.id === server.id)),
    [activedMcpServers, mcpServers]
  )
  const handleMcpServerSelect = useCallback(
    (server: MCPServer) => {
      if (assistantMcpServers.some((s) => s.id === server.id)) {
        updateAssistant({ ...assistant, mcpServers: mcpServers?.filter((s) => s.id !== server.id) })
      } else {
        updateAssistant({ ...assistant, mcpServers: [...mcpServers, server] })
      }
    },
    [assistant, assistantMcpServers, mcpServers, updateAssistant]
  )

  // 使用 useRef 缓存事件处理函数
  const handleMcpServerSelectRef = useRef(handleMcpServerSelect)
  handleMcpServerSelectRef.current = handleMcpServerSelect

  useEffect(() => {
    const handler = (server: MCPServer) => handleMcpServerSelectRef.current(server)
    EventEmitter.on('mcp-server-select', handler)
    return () => EventEmitter.off('mcp-server-select', handler)
  }, [])

  const updateMcpEnabled = useCallback(
    (enabled: boolean) => {
      setTimeout(() => {
        updateAssistant({
          ...assistant,
          mcpServers: enabled ? assistant.mcpServers || [] : []
        })
      }, 200)
    },
    [assistant, updateAssistant]
  )

  const menuItems = useMemo(() => {
    const newList: QuickPanelListItem[] = activedMcpServers.map((server) => ({
      label: server.name,
      description: server.description || server.baseUrl,
      icon: <SquareTerminal />,
      action: () => EventEmitter.emit('mcp-server-select', server),
      isSelected: assistantMcpServers.some((s) => s.id === server.id)
    }))

    newList.push({
      label: t('settings.mcp.addServer.label') + '...',
      icon: <Plus />,
      action: () => navigate('/settings/mcp')
    })

    newList.unshift({
      label: t('common.close'),
      description: t('settings.mcp.disable.description'),
      icon: <CircleX />,
      isSelected: false,
      action: () => {
        updateMcpEnabled(false)
        quickPanel.close()
      }
    })

    return newList
  }, [activedMcpServers, t, assistantMcpServers, navigate, updateMcpEnabled, quickPanel])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('settings.mcp.title'),
      list: menuItems,
      symbol: 'mcp',
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [menuItems, quickPanel, t])

  // 使用 useCallback 优化 insertPromptIntoTextArea
  const insertPromptIntoTextArea = useCallback(
    (promptText: string) => {
      setInputValue((prev) => {
        const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement
        if (!textArea) return prev + promptText

        const cursorPosition = textArea.selectionStart
        const selectionStart = cursorPosition
        const selectionEndPosition = cursorPosition + promptText.length
        const newText = prev.slice(0, cursorPosition) + promptText + prev.slice(cursorPosition)

        // 使用 requestAnimationFrame 优化 DOM 操作
        requestAnimationFrame(() => {
          textArea.focus()
          textArea.setSelectionRange(selectionStart, selectionEndPosition)
          resizeTextArea()
        })
        return newText
      })
    },
    [setInputValue, resizeTextArea]
  )

  const handlePromptSelect = useCallback(
    (prompt: MCPPromptWithArgs) => {
      const server = activedMcpServers.find((s) => s.id === prompt.serverId)
      if (!server) return

      const handlePromptResponse = async (response: any) => {
        const promptContent = extractPromptContent(response)
        if (promptContent) {
          insertPromptIntoTextArea(promptContent)
        } else {
          throw new Error('Invalid prompt response format')
        }
      }

      const handlePromptWithArgs = async () => {
        try {
          form.resetFields()

          const result = await new Promise<Record<string, string>>((resolve, reject) => {
            window.modal.confirm({
              title: `${t('settings.mcp.prompts.arguments')}: ${prompt.name}`,
              content: (
                <Form form={form} layout="vertical">
                  {prompt.arguments?.map((arg, index) => (
                    <Form.Item
                      key={index}
                      name={arg.name}
                      label={`${arg.name}${arg.required ? ' *' : ''}`}
                      tooltip={arg.description}
                      rules={
                        arg.required ? [{ required: true, message: t('settings.mcp.prompts.requiredField') }] : []
                      }>
                      <Input placeholder={arg.description || arg.name} />
                    </Form.Item>
                  ))}
                </Form>
              ),
              onOk: async () => {
                try {
                  const values = await form.validateFields()
                  resolve(values)
                } catch (error) {
                  reject(error)
                }
              },
              onCancel: () => reject(new Error('cancelled')),
              okText: t('common.confirm'),
              cancelText: t('common.cancel')
            })
          })

          const response = await window.api.mcp.getPrompt({
            server,
            name: prompt.name,
            args: result
          })

          await handlePromptResponse(response)
        } catch (error: Error | any) {
          if (error.message !== 'cancelled') {
            window.modal.error({
              title: t('common.error'),
              content: error.message || t('settings.mcp.prompts.genericError')
            })
          }
        }
      }

      const handlePromptWithoutArgs = async () => {
        try {
          const response = await window.api.mcp.getPrompt({
            server,
            name: prompt.name
          })
          await handlePromptResponse(response)
        } catch (error: Error | any) {
          window.modal.error({
            title: t('common.error'),
            content: error.message || t('settings.mcp.prompts.genericError')
          })
        }
      }

      requestAnimationFrame(() => {
        const hasArguments = prompt.arguments && prompt.arguments.length > 0
        if (hasArguments) {
          handlePromptWithArgs()
        } else {
          handlePromptWithoutArgs()
        }
      })
    },
    [activedMcpServers, form, t, insertPromptIntoTextArea]
  )

  const promptList = useMemo(async () => {
    const prompts: MCPPrompt[] = []

    for (const server of activedMcpServers) {
      const serverPrompts = await window.api.mcp.listPrompts(server)
      prompts.push(...serverPrompts)
    }

    return prompts.map((prompt) => ({
      label: prompt.name,
      description: prompt.description,
      icon: <SquareTerminal />,
      action: () => handlePromptSelect(prompt as MCPPromptWithArgs)
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activedMcpServers])

  const openPromptList = useCallback(async () => {
    const prompts = await promptList
    quickPanel.open({
      title: t('settings.mcp.title'),
      list: prompts,
      symbol: 'mcp-prompt',
      multiple: true
    })
  }, [promptList, quickPanel, t])

  const handleResourceSelect = useCallback(
    (resource: MCPResource) => {
      const server = activedMcpServers.find((s) => s.id === resource.serverId)
      if (!server) return

      const processResourceContent = (resourceData: ResourceData) => {
        if (resourceData.blob) {
          if (resourceData.mimeType?.startsWith('image/')) {
            const imageMarkdown = `![${resourceData.name || 'Image'}](data:${resourceData.mimeType};base64,${resourceData.blob})`
            insertPromptIntoTextArea(imageMarkdown)
          } else {
            const resourceInfo = `[${resourceData.name || resource.name} - ${resourceData.mimeType || t('settings.mcp.resources.blobInvisible')}]`
            insertPromptIntoTextArea(resourceInfo)
          }
        } else if (resourceData.text) {
          insertPromptIntoTextArea(resourceData.text)
        } else {
          const resourceInfo = `[${resourceData.name || resource.name} - ${resourceData.uri || resource.uri}]`
          insertPromptIntoTextArea(resourceInfo)
        }
      }

      requestAnimationFrame(async () => {
        try {
          const response = await window.api.mcp.getResource({
            server,
            uri: resource.uri
          })

          if (response?.contents && Array.isArray(response.contents)) {
            response.contents.forEach((content: ResourceData) => processResourceContent(content))
          } else {
            processResourceContent(response as ResourceData)
          }
        } catch (error: Error | any) {
          window.modal.error({
            title: t('common.error'),
            content: error.message || t('settings.mcp.resources.genericError')
          })
        }
      })
    },
    [activedMcpServers, t, insertPromptIntoTextArea]
  )

  // 优化 resourcesList 的状态更新
  const [resourcesList, setResourcesList] = useState<QuickPanelListItem[]>([])

  useEffect(() => {
    let isMounted = true

    const fetchResources = async () => {
      const resources: MCPResource[] = []

      for (const server of activedMcpServers) {
        const serverResources = await window.api.mcp.listResources(server)
        resources.push(...serverResources)
      }

      if (isMounted) {
        setResourcesList(
          resources.map((resource) => ({
            label: resource.name,
            description: resource.description,
            icon: <SquareTerminal />,
            action: () => handleResourceSelect(resource)
          }))
        )
      }
    }

    fetchResources()

    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activedMcpServers])

  const openResourcesList = useCallback(async () => {
    quickPanel.open({
      title: t('settings.mcp.title'),
      list: resourcesList,
      symbol: 'mcp-resource',
      multiple: true
    })
  }, [resourcesList, quickPanel, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === 'mcp') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel,
    openPromptList,
    openResourcesList
  }))

  return (
    <Tooltip placement="top" title={t('settings.mcp.title')} mouseLeaveDelay={0} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <SquareTerminal
          size={18}
          color={assistant.mcpServers && assistant.mcpServers.length > 0 ? 'var(--color-primary)' : 'var(--color-icon)'}
        />
      </ToolbarButton>
    </Tooltip>
  )
}

// 使用 React.memo 包装组件
export default React.memo(MCPToolsButton)
