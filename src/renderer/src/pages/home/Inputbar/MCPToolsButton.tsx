import { CodeOutlined, PlusOutlined } from '@ant-design/icons'
import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPPrompt, MCPServer } from '@renderer/types'
import { Form, Input, Modal, Tooltip } from 'antd'
import { SquareTerminal } from 'lucide-react'
import { FC, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface MCPToolsButtonRef {
  openQuickPanel: () => void
  openPromptList: () => void
}

interface Props {
  ref?: React.RefObject<MCPToolsButtonRef | null>
  enabledMCPs: MCPServer[]
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  toggelEnableMCP: (server: MCPServer) => void
  ToolbarButton: any
}

const MCPToolsButton: FC<Props> = ({
  ref,
  setInputValue,
  resizeTextArea,
  enabledMCPs,
  toggelEnableMCP,
  ToolbarButton
}) => {
  const { activedMcpServers } = useMCPServers()
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const navigate = useNavigate()
  // Create form instance at the top level
  const [form] = Form.useForm()

  const availableMCPs = activedMcpServers.filter((server) => enabledMCPs.some((s) => s.id === server.id))

  const buttonEnabled = availableMCPs.length > 0

  const menuItems = useMemo(() => {
    const newList: QuickPanelListItem[] = activedMcpServers.map((server) => ({
      label: server.name,
      description: server.description || server.baseUrl,
      icon: <CodeOutlined />,
      action: () => toggelEnableMCP(server),
      isSelected: enabledMCPs.some((s) => s.id === server.id)
    }))

    newList.push({
      label: t('settings.mcp.addServer') + '...',
      icon: <PlusOutlined />,
      action: () => navigate('/settings/mcp')
    })
    return newList
  }, [activedMcpServers, t, enabledMCPs, toggelEnableMCP, navigate])

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
  // Extract and format all content from the prompt response
  const extractPromptContent = useCallback((response: any): string | null => {
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
            // Add formatted text content with role
            formattedContent += `${rolePrefix}${message.content.text}\n\n`
            break

          case 'image':
            // Format image as markdown with proper attribution
            if (message.content.data && message.content.mimeType) {
              const imageData = message.content.data
              const mimeType = message.content.mimeType
              // Include role if available
              if (rolePrefix) {
                formattedContent += `${rolePrefix}\n`
              }
              formattedContent += `![Image](data:${mimeType};base64,${imageData})\n\n`
            }
            break

          case 'audio':
            // Add indicator for audio content with role
            formattedContent += `${rolePrefix}[Audio content available]\n\n`
            break

          case 'resource':
            // Add indicator for resource content with role
            if (message.content.text) {
              formattedContent += `${rolePrefix}${message.content.text}\n\n`
            } else {
              formattedContent += `${rolePrefix}[Resource content available]\n\n`
            }
            break

          default:
            // Add text content if available with role, otherwise show placeholder
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
  }, [])

  // Helper function to insert prompt into text area
  const insertPromptIntoTextArea = useCallback(
    (promptText: string) => {
      setInputValue((prev) => {
        const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement
        if (!textArea) return prev + promptText // Fallback if we can't find the textarea

        const cursorPosition = textArea.selectionStart
        const selectionStart = cursorPosition
        const selectionEndPosition = cursorPosition + promptText.length
        const newText = prev.slice(0, cursorPosition) + promptText + prev.slice(cursorPosition)

        setTimeout(() => {
          textArea.focus()
          textArea.setSelectionRange(selectionStart, selectionEndPosition)
          resizeTextArea()
        }, 10)
        return newText
      })
    },
    [setInputValue, resizeTextArea]
  )

  const handlePromptSelect = useCallback(
    (prompt: MCPPrompt) => {
      setTimeout(async () => {
        const server = enabledMCPs.find((s) => s.id === prompt.serverId)
        if (server) {
          try {
            // Check if the prompt has arguments
            if (prompt.arguments && prompt.arguments.length > 0) {
              // Reset form when opening a new modal
              form.resetFields()

              Modal.confirm({
                title: `${t('settings.mcp.prompts.arguments')}: ${prompt.name}`,
                content: (
                  <Form form={form} layout="vertical">
                    {prompt.arguments.map((arg, index) => (
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
                    // Validate and get form values
                    const values = await form.validateFields()

                    const response = await window.api.mcp.getPrompt({
                      server,
                      name: prompt.name,
                      args: values
                    })

                    // Extract and format prompt content from the response
                    const promptContent = extractPromptContent(response)
                    if (promptContent) {
                      insertPromptIntoTextArea(promptContent)
                    } else {
                      throw new Error('Invalid prompt response format')
                    }

                    return Promise.resolve()
                  } catch (error: Error | any) {
                    if (error.errorFields) {
                      // This is a form validation error, handled by Ant Design
                      return Promise.reject(error)
                    }

                    Modal.error({
                      title: t('common.error'),
                      content: error.message || t('settings.mcp.prompts.genericError')
                    })
                    return Promise.reject(error)
                  }
                },
                okText: t('common.confirm'),
                cancelText: t('common.cancel')
              })
            } else {
              // If no arguments, get the prompt directly
              const response = await window.api.mcp.getPrompt({
                server,
                name: prompt.name
              })

              // Extract and format prompt content from the response
              const promptContent = extractPromptContent(response)
              if (promptContent) {
                insertPromptIntoTextArea(promptContent)
              } else {
                throw new Error('Invalid prompt response format')
              }
            }
          } catch (error: Error | any) {
            Modal.error({
              title: t('common.error'),
              content: error.message || t('settings.mcp.prompt.genericError')
            })
          }
        }
      }, 10)
    },
    [enabledMCPs, form, t, extractPromptContent, insertPromptIntoTextArea] // Add form to dependencies
  )

  const promptList = useMemo(async () => {
    const prompts: MCPPrompt[] = []

    for (const server of enabledMCPs) {
      const serverPrompts = await window.api.mcp.listPrompts(server)
      prompts.push(...serverPrompts)
    }

    return prompts.map((prompt) => ({
      label: prompt.name,
      description: prompt.description,
      icon: <CodeOutlined />,
      action: () => handlePromptSelect(prompt)
    }))
  }, [handlePromptSelect, enabledMCPs])

  const openPromptList = useCallback(async () => {
    const prompts = await promptList
    quickPanel.open({
      title: t('settings.mcp.title'),
      list: prompts,
      symbol: 'mcp-prompt',
      multiple: true
    })
  }, [promptList, quickPanel, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === 'mcp') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel,
    openPromptList
  }))

  if (activedMcpServers.length === 0) {
    return null
  }

  return (
    <Tooltip placement="top" title={t('settings.mcp.title')} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <SquareTerminal size={18} color={buttonEnabled ? 'var(--color-primary)' : 'var(--color-icon)'} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default MCPToolsButton
