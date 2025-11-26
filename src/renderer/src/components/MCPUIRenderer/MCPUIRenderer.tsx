import { loggerService } from '@logger'
import type { UIActionResult } from '@mcp-ui/client'
import { UIResourceRenderer } from '@mcp-ui/client'
import type { EmbeddedResource } from '@modelcontextprotocol/sdk/types.js'
import { isUIResource } from '@renderer/types'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('MCPUIRenderer')

interface Props {
  resource: EmbeddedResource
  serverId?: string
  serverName?: string
  onToolCall?: (toolName: string, params: any) => Promise<any>
}

const MCPUIRenderer: FC<Props> = ({ resource, onToolCall }) => {
  const { t } = useTranslation()
  const [error] = useState<string | null>(null)

  const handleUIAction = useCallback(
    async (result: UIActionResult): Promise<any> => {
      logger.debug('UI Action received:', result)

      try {
        switch (result.type) {
          case 'tool': {
            // Handle tool call from UI
            if (onToolCall) {
              const { toolName, params } = result.payload
              logger.info(`UI requesting tool call: ${toolName}`, { params })
              const response = await onToolCall(toolName, params)

              // Check if the response contains a UIResource
              try {
                if (response && response.content && Array.isArray(response.content)) {
                  const firstContent = response.content[0]
                  if (firstContent && firstContent.type === 'text' && firstContent.text) {
                    const parsedText = JSON.parse(firstContent.text)
                    if (isUIResource(parsedText)) {
                      // Return the UIResource directly for rendering in the iframe
                      logger.info('Tool response contains UIResource:', { uri: parsedText.resource.uri })
                      return { status: 'success', data: parsedText }
                    }
                  }
                }
              } catch (parseError) {
                // Not a UIResource, return the original response
                logger.debug('Tool response is not a UIResource')
              }

              return { status: 'success', data: response }
            } else {
              logger.warn('Tool call requested but no handler provided')
              return { status: 'error', message: 'Tool call handler not available' }
            }
          }

          case 'intent': {
            // Handle user intent
            logger.info('UI intent:', result.payload)
            window.toast.info(t('message.mcp.ui.intent_received'))
            return { status: 'acknowledged' }
          }

          case 'notify': {
            // Handle notification from UI
            logger.info('UI notification:', result.payload)
            window.toast.info(result.payload.message || t('message.mcp.ui.notification'))
            return { status: 'acknowledged' }
          }

          case 'prompt': {
            // Handle prompt request from UI
            logger.info('UI prompt request:', result.payload)
            // TODO: Integrate with prompt system
            return { status: 'error', message: 'Prompt execution not yet implemented' }
          }

          case 'link': {
            // Handle navigation request
            const { url } = result.payload
            logger.info('UI navigation request:', { url })
            window.open(url, '_blank')
            return { status: 'acknowledged' }
          }

          default:
            logger.warn('Unknown UI action type:', { result })
            return { status: 'error', message: 'Unknown action type' }
        }
      } catch (err) {
        logger.error('Error handling UI action:', err as Error)
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error'
        }
      }
    },
    [onToolCall, t]
  )

  if (error) {
    return (
      <ErrorContainer>
        <ErrorTitle>{t('message.mcp.ui.error')}</ErrorTitle>
        <ErrorMessage>{error}</ErrorMessage>
      </ErrorContainer>
    )
  }

  return (
    <UIContainer>
      <UIResourceRenderer resource={resource} onUIAction={handleUIAction} />
    </UIContainer>
  )
}

const UIContainer = styled.div`
  width: 100%;
  min-height: 400px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-background);
  border: 1px solid var(--color-border);

  iframe {
    width: 100%;
    border: none;
    min-height: 400px;
    height: 600px;
  }
`

const ErrorContainer = styled.div`
  padding: 16px;
  border-radius: 8px;
  background: var(--color-error-bg, #fee);
  border: 1px solid var(--color-error-border, #fcc);
  color: var(--color-error-text, #c33);
`

const ErrorTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
`

const ErrorMessage = styled.div`
  font-size: 13px;
  opacity: 0.9;
`

export default MCPUIRenderer
