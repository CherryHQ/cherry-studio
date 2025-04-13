import { MCPTool } from '@renderer/types'

export const SYSTEM_PROMPT = `In this environment you have access to a set of tools you can use to answer the user's question. \
You can use one tool per message, and will receive the result of that tool use in the user's response. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

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

Now Begin! If you solve the task correctly, you will receive a reward of $1,000,000.
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

import { applyMemoriesToPrompt } from '@renderer/services/MemoryService'
import { MCPServer } from '@renderer/types'

import { getRememberedMemories } from './remember-utils'
export const buildSystemPrompt = async (
  userSystemPrompt: string,
  tools: MCPTool[],
  mcpServers: MCPServer[] = []
): Promise<string> => {
  // 获取MCP记忆
  let mcpMemoriesPrompt = ''
  try {
    mcpMemoriesPrompt = await getRememberedMemories(mcpServers)
  } catch (error) {
    console.error('Error getting MCP memories:', error)
  }

  // 获取内置记忆
  let appMemoriesPrompt = ''
  try {
    // 应用内置记忆功能
    console.log('[Prompt] Applying app memories to prompt')
    // 直接将用户系统提示词传递给 applyMemoriesToPrompt，让它添加记忆
    appMemoriesPrompt = applyMemoriesToPrompt(userSystemPrompt)
    console.log('[Prompt] App memories prompt length:', appMemoriesPrompt.length - userSystemPrompt.length)
  } catch (error) {
    console.error('Error applying app memories:', error)
    // 如果应用 Redux 记忆失败，至少保留原始用户提示
    appMemoriesPrompt = userSystemPrompt
  }

  // 添加记忆工具的使用说明
  // 合并所有提示词
  // 注意：appMemoriesPrompt 已经包含 userSystemPrompt，所以不需要再次添加
  // 合并 app 记忆（已包含 user prompt）和 mcp 记忆
  const enhancedPrompt = appMemoriesPrompt + (mcpMemoriesPrompt ? `\n\n${mcpMemoriesPrompt}` : '')

  let finalPrompt: string
  if (tools && tools.length > 0) {
    console.log('[Prompt] Final prompt with tools:', { promptLength: enhancedPrompt.length })
    // Break down the chained replace calls to potentially help the parser
    const availableToolsString = AvailableTools(tools)
    let tempPrompt = SYSTEM_PROMPT.replace('{{ USER_SYSTEM_PROMPT }}', enhancedPrompt)
    tempPrompt = tempPrompt.replace('{{ TOOL_USE_EXAMPLES }}', ToolUseExamples)
    finalPrompt = tempPrompt.replace('{{ AVAILABLE_TOOLS }}', availableToolsString)
  } else {
    console.log('[Prompt] Final prompt without tools:', { promptLength: enhancedPrompt.length })
    finalPrompt = enhancedPrompt // Assign enhancedPrompt when no tools are present
  }
  // Single return point for the function
  return finalPrompt
} // Closing brace for the buildSystemPrompt function moved here
