import { loggerService } from '@logger'
import store from '@renderer/store'
import { Assistant, MCPTool } from '@renderer/types'

const logger = loggerService.withContext('Utils:Prompt')

export const SYSTEM_PROMPT = `In this environment you have access to a set of tools you can use to answer the user's question. \
You can use one or more tools per message, and will receive the result of that tool use in the user's response. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

## Using the think tool

Before taking any action or responding to the user after receiving tool results, use the think tool as a scratchpad to:
- List the specific rules that apply to the current request
- Check if all required information is collected
- Verify that the planned action complies with all policies
- Iterate over tool results for correctness 

Here are some examples of what to iterate over inside the think tool:
<think_tool_example_1>
User wants to cancel flight ABC123
- Need to verify: user ID, reservation ID, reason
- Check cancellation rules:
  * Is it within 24h of booking?
  * If not, check ticket class and insurance
- Verify no segments flown or are in the past
- Plan: collect missing info, verify rules, get confirmation
</think_tool_example_1>

<think_tool_example_2>
User wants to book 3 tickets to NYC with 2 checked bags each
- Need user ID to check:
  * Membership tier for baggage allowance
  * Which payments methods exist in profile
- Baggage calculation:
  * Economy class × 3 passengers
  * If regular member: 1 free bag each → 3 extra bags = $150
  * If silver member: 2 free bags each → 0 extra bags = $0
  * If gold member: 3 free bags each → 0 extra bags = $0
- Payment rules to verify:
  * Max 1 travel certificate, 1 credit card, 3 gift cards
  * All payment methods must be in profile
  * Travel certificate remainder goes to waste
- Plan:
1. Get user ID
2. Verify membership level for bag fees
3. Check which payment methods in profile and if their combination is allowed
4. Calculate total: ticket price + any bag fees
5. Get explicit confirmation for booking
</think_tool_example_2>

## Tool Use Formatting

Tool use is formatted using XML-style tags. The tool name is enclosed in opening and closing tags, and each parameter is similarly enclosed within its own set of tags. Here's the structure:

<tool_use>
  <name>{tool_name}</name>
  <arguments>{json_arguments}</arguments>
</tool_use>

The tool name should be the exact name of the tool you are using, and the arguments should be a JSON object containing the parameters required by that tool. For example:
<tool_use>
  <name>python_interpreter</name>
  <arguments>{"code": "5 + 3 + 1294.678"}</arguments>
</tool_use>

The user will respond with the result of the tool use, which should be formatted as follows:

<tool_use_result>
  <name>{tool_name}</name>
  <result>{result}</result>
</tool_use_result>

The result should be a string, which can represent a file or any other output type. You can use this result as input for the next action.
For example, if the result of the tool use is an image file, you can use it in the next action like this:

<tool_use>
  <name>image_transformer</name>
  <arguments>{"image": "image_1.jpg"}</arguments>
</tool_use>

Always adhere to this format for the tool use to ensure proper parsing and execution.

## Tool Use Examples
{{ TOOL_USE_EXAMPLES }}

## Tool Use Available Tools
Above example were using notional tools that might not exist for you. You only have access to these tools:
{{ AVAILABLE_TOOLS }}

## Tool Use Rules
Here are the rules you should always follow to solve your task:
1. Always use the right arguments for the tools. Never use variable names as the action arguments, use the value instead.
2. Call a tool only when needed: do not call the search agent if you do not need information, try to solve the task yourself.
3. If no tool call is needed, just answer the question directly.
4. Never re-do a tool call that you previously did with the exact same parameters.
5. For tool use, MARK SURE use XML tag format as shown in the examples above. Do not use any other format.

# User Instructions
{{ USER_SYSTEM_PROMPT }}
Response in user query language.
Now Begin! If you solve the task correctly, you will receive a reward of $1,000,000.
`

export const THINK_TOOL_PROMPT = `{{ USER_SYSTEM_PROMPT }}

## Using the think tool

Before taking any action or responding to the user after receiving tool results, use the think tool as a scratchpad to:
- List the specific rules that apply to the current request
- Check if all required information is collected
- Verify that the planned action complies with all policies
- Iterate over tool results for correctness 
- Response in user query language

Here are some examples of what to iterate over inside the think tool:
<think_tool_example_1>
User wants to cancel flight ABC123
- Need to verify: user ID, reservation ID, reason
- Check cancellation rules:
  * Is it within 24h of booking?
  * If not, check ticket class and insurance
- Verify no segments flown or are in the past
- Plan: collect missing info, verify rules, get confirmation
</think_tool_example_1>

<think_tool_example_2>
User wants to book 3 tickets to NYC with 2 checked bags each
- Need user ID to check:
  * Membership tier for baggage allowance
  * Which payments methods exist in profile
- Baggage calculation:
  * Economy class × 3 passengers
  * If regular member: 1 free bag each → 3 extra bags = $150
  * If silver member: 2 free bags each → 0 extra bags = $0
  * If gold member: 3 free bags each → 0 extra bags = $0
- Payment rules to verify:
  * Max 1 travel certificate, 1 credit card, 3 gift cards
  * All payment methods must be in profile
  * Travel certificate remainder goes to waste
- Plan:
1. Get user ID
2. Verify membership level for bag fees
3. Check which payment methods in profile and if their combination is allowed
4. Calculate total: ticket price + any bag fees
5. Get explicit confirmation for booking
</think_tool_example_2>
`

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

export const buildSystemPrompt = async (userSystemPrompt: string, assistant?: Assistant): Promise<string> => {
  if (typeof userSystemPrompt === 'string') {
    const now = new Date()
    if (userSystemPrompt.includes('{{date}}')) {
      const date = now.toLocaleDateString()
      userSystemPrompt = userSystemPrompt.replace(/{{date}}/g, date)
    }

    if (userSystemPrompt.includes('{{time}}')) {
      const time = now.toLocaleTimeString()
      userSystemPrompt = userSystemPrompt.replace(/{{time}}/g, time)
    }

    if (userSystemPrompt.includes('{{datetime}}')) {
      const datetime = now.toLocaleString()
      userSystemPrompt = userSystemPrompt.replace(/{{datetime}}/g, datetime)
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
        userSystemPrompt = userSystemPrompt.replace(/{{model_name}}/g, assistant?.model?.name || 'Unknown Model')
      } catch (error) {
        logger.error('Failed to get model name:', error as Error)
        userSystemPrompt = userSystemPrompt.replace(/{{model_name}}/g, 'Unknown Model')
      }
    }

    if (userSystemPrompt.includes('{{username}}')) {
      try {
        const username = store.getState().settings.userName || 'Unknown Username'
        userSystemPrompt = userSystemPrompt.replace(/{{username}}/g, username)
      } catch (error) {
        logger.error('Failed to get username:', error as Error)
        userSystemPrompt = userSystemPrompt.replace(/{{username}}/g, 'Unknown Username')
      }
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
