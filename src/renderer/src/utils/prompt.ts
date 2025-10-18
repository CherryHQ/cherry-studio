import { loggerService } from '@logger'
import store from '@renderer/store'
import { MCPTool } from '@renderer/types'

const logger = loggerService.withContext('Utils:Prompt')

export const SYSTEM_PROMPT = `
{{ USER_SYSTEM_PROMPT }}
`

export const THINK_TOOL_PROMPT = `{{ USER_SYSTEM_PROMPT }}`

export const ToolUseExamples = `
Here are a few examples using notional tools:
---
User: Generate an image of the oldest person in this document.

Assistant: I can use the document_qa tool to find out who the oldest person is in the document.
<tool_use>
  <name>document_qa</name>
  <arguments>{"document": "document.pdf", "question": "Who is the oldest person mentioned?"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>document_qa</name>
  <result>John Doe, a 55 year old lumberjack living in Newfoundland.</result>
</tool_use_result>

Assistant: I can use the image_generator tool to create a portrait of John Doe.
<tool_use>
  <name>image_generator</name>
  <arguments>{"prompt": "A portrait of John Doe, a 55-year-old man living in Canada."}</arguments>
</tool_use>

User: <tool_use_result>
  <name>image_generator</name>
  <result>image.png</result>
</tool_use_result>

Assistant: the image is generated as image.png

---
User: "What is the result of the following operation: 5 + 3 + 1294.678?"

Assistant: I can use the python_interpreter tool to calculate the result of the operation.
<tool_use>
  <name>python_interpreter</name>
  <arguments>{"code": "5 + 3 + 1294.678"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>python_interpreter</name>
  <result>1302.678</result>
</tool_use_result>

Assistant: The result of the operation is 1302.678.

---
User: "Which city has the highest population , Guangzhou or Shanghai?"

Assistant: I can use the search tool to find the population of Guangzhou.
<tool_use>
  <name>search</name>
  <arguments>{"query": "Population Guangzhou"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>search</name>
  <result>Guangzhou has a population of 15 million inhabitants as of 2021.</result>
</tool_use_result>

Assistant: I can use the search tool to find the population of Shanghai.
<tool_use>
  <name>search</name>
  <arguments>{"query": "Population Shanghai"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>search</name>
  <result>26 million (2019)</result>
</tool_use_result>
Assistant: The population of Shanghai is 26 million, while Guangzhou has a population of 15 million. Therefore, Shanghai has the highest population.
`

export const AvailableTools = (tools: MCPTool[]) => {
  const availableTools = tools
    .map((tool) => {
      return `
<tool>
  <name>${tool.id}</name>
  <description>${tool.description}</description>
  <arguments>
    ${tool.inputSchema ? JSON.stringify(tool.inputSchema) : ''}
  </arguments>
</tool>
`
    })
    .join('\n')
  return `<tools>
${availableTools}
</tools>`
}

const supportedVariables = [
  '{{username}}',
  '{{date}}',
  '{{time}}',
  '{{datetime}}',
  '{{system}}',
  '{{language}}',
  '{{arch}}',
  '{{model_name}}'
]

export const containsSupportedVariables = (userSystemPrompt: string): boolean => {
  return supportedVariables.some((variable) => userSystemPrompt.includes(variable))
}

export const replacePromptVariables = async (userSystemPrompt: string, modelName?: string): Promise<string> => {
  if (typeof userSystemPrompt !== 'string') {
    logger.warn('User system prompt is not a string:', userSystemPrompt)
    return userSystemPrompt
  }

  const now = new Date()
  if (userSystemPrompt.includes('{{date}}')) {
    const date = now.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    })
    userSystemPrompt = userSystemPrompt.replace(/{{date}}/g, date)
  }

  if (userSystemPrompt.includes('{{time}}')) {
    const time = now.toLocaleTimeString()
    userSystemPrompt = userSystemPrompt.replace(/{{time}}/g, time)
  }

  if (userSystemPrompt.includes('{{datetime}}')) {
    const datetime = now.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    userSystemPrompt = userSystemPrompt.replace(/{{datetime}}/g, datetime)
  }

  if (userSystemPrompt.includes('{{username}}')) {
    try {
      const userName = store.getState().settings.userName || 'Unknown Username'
      userSystemPrompt = userSystemPrompt.replace(/{{username}}/g, userName)
    } catch (error) {
      logger.error('Failed to get username:', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{username}}/g, 'Unknown Username')
    }
  }

  if (userSystemPrompt.includes('{{system}}')) {
    try {
      const systemType = await window.api.system.getDeviceType()
      userSystemPrompt = userSystemPrompt.replace(/{{system}}/g, systemType)
    } catch (error) {
      logger.error('Failed to get system type:', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{system}}/g, 'Unknown System')
    }
  }

  if (userSystemPrompt.includes('{{language}}')) {
    try {
      const language = store.getState().settings.language
      userSystemPrompt = userSystemPrompt.replace(/{{language}}/g, language)
    } catch (error) {
      logger.error('Failed to get language:', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{language}}/g, 'Unknown System Language')
    }
  }

  if (userSystemPrompt.includes('{{arch}}')) {
    try {
      const appInfo = await window.api.getAppInfo()
      userSystemPrompt = userSystemPrompt.replace(/{{arch}}/g, appInfo.arch)
    } catch (error) {
      logger.error('Failed to get architecture:', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{arch}}/g, 'Unknown Architecture')
    }
  }

  if (userSystemPrompt.includes('{{model_name}}')) {
    try {
      const name = modelName || store.getState().llm.defaultModel?.name
      userSystemPrompt = userSystemPrompt.replace(/{{model_name}}/g, name)
    } catch (error) {
      logger.error('Failed to get model name:', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{model_name}}/g, 'Unknown Model')
    }
  }

  return userSystemPrompt
}

export const buildSystemPromptWithTools = (userSystemPrompt: string, tools?: MCPTool[]): string => {
  if (tools && tools.length > 0) {
    return SYSTEM_PROMPT.replace('{{ USER_SYSTEM_PROMPT }}', userSystemPrompt || '')
      .replace('{{ TOOL_USE_EXAMPLES }}', ToolUseExamples)
      .replace('{{ AVAILABLE_TOOLS }}', AvailableTools(tools))
  }
  return userSystemPrompt
}

export const buildSystemPromptWithThinkTool = (userSystemPrompt: string): string => {
  return THINK_TOOL_PROMPT.replace('{{ USER_SYSTEM_PROMPT }}', userSystemPrompt || '')
}
