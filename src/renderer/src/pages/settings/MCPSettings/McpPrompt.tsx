import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ColFlex,
  EmptyState,
  Flex,
  Tooltip
} from '@cherrystudio/ui'
import type { MCPPrompt } from '@renderer/types'
import { useTranslation } from 'react-i18next'

import { McpDetailItem, McpDetailList, RequiredMark } from './McpDetailList'

interface MCPPromptsSectionProps {
  prompts: MCPPrompt[]
}

const MCPPromptsSection = ({ prompts }: MCPPromptsSectionProps) => {
  const { t } = useTranslation()

  // Render prompt arguments
  const renderPromptArguments = (prompt: MCPPrompt) => {
    if (!prompt.arguments || prompt.arguments.length === 0) return null

    return (
      <div className="mt-3">
        <h4 className="mb-2 font-medium text-foreground text-sm">{t('settings.mcp.tools.inputSchema.label')}:</h4>
        <McpDetailList>
          {prompt.arguments.map((arg, index) => (
            <McpDetailItem
              key={index}
              label={
                <Flex className="gap-1">
                  <span className="font-medium">{arg.name}</span>
                  {arg.required && (
                    <Tooltip content={t('common.required_field')}>
                      <RequiredMark />
                    </Tooltip>
                  )}
                </Flex>
              }>
              <ColFlex className="gap-1">
                {arg.description && (
                  <p className="m-0 text-foreground-secondary text-sm leading-5">{arg.description}</p>
                )}
              </ColFlex>
            </McpDetailItem>
          ))}
        </McpDetailList>
      </div>
    )
  }

  return (
    <div className="mt-2 pt-2">
      {prompts.length > 0 ? (
        <>
          <h3 className="mb-2 font-medium text-foreground-secondary text-sm">
            {t('settings.mcp.prompts.availablePrompts')}
          </h3>
          <Accordion type="multiple">
            {prompts.map((prompt) => (
              <AccordionItem key={prompt.id || prompt.name} value={prompt.id || prompt.name}>
                <AccordionTrigger className="py-3">
                  <ColFlex className="min-w-0 items-start">
                    <Flex className="w-full min-w-0 items-center">
                      <span className="truncate font-medium text-foreground text-sm">{prompt.name}</span>
                    </Flex>
                    {prompt.description && (
                      <span className="mt-1 text-[13px] text-foreground-secondary leading-5">{prompt.description}</span>
                    )}
                  </ColFlex>
                </AccordionTrigger>
                <AccordionContent className="select-text px-3">{renderPromptArguments(prompt)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </>
      ) : (
        <EmptyState compact preset="no-result" description={t('settings.mcp.prompts.noPromptsAvailable')} />
      )}
    </div>
  )
}

export default MCPPromptsSection
