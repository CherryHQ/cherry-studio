/**
 * 内置插件：MCP Prompt 模式
 * 为不支持原生 Function Call 的模型提供 prompt 方式的工具调用
 * 内置默认逻辑，支持自定义覆盖
 */
import type { TextStreamPart, ToolSet } from 'ai'

import { definePlugin } from '../../index'
import type { AiRequestContext } from '../../types'
import { StreamEventManager } from './StreamEventManager'
import { ToolExecutor } from './ToolExecutor'
import { PromptToolUseConfig, ToolUseResult } from './type'

/**
 * 默认系统提示符模板（提取自 Cherry Studio）
 */
const DEFAULT_SYSTEM_PROMPT = `In this environment you have access to a set of tools you can use to answer the user's question. \\
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
5. For tool use, MAKE SURE use XML tag format as shown in the examples above. Do not use any other format.

# User Instructions
{{ USER_SYSTEM_PROMPT }}

Now Begin! If you solve the task correctly, you will receive a reward of $1,000,000.`

/**
 * 默认工具使用示例（提取自 Cherry Studio）
 */
const DEFAULT_TOOL_USE_EXAMPLES = `
Here are a few examples using notional tools:
---
User: Generate an image of the oldest person in this document.

A: I can use the document_qa tool to find out who the oldest person is in the document.
<tool_use>
  <name>document_qa</name>
  <arguments>{"document": "document.pdf", "question": "Who is the oldest person mentioned?"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>document_qa</name>
  <result>John Doe, a 55 year old lumberjack living in Newfoundland.</result>
</tool_use_result>

A: I can use the image_generator tool to create a portrait of John Doe.
<tool_use>
  <name>image_generator</name>
  <arguments>{"prompt": "A portrait of John Doe, a 55-year-old man living in Canada."}</arguments>
</tool_use>

User: <tool_use_result>
  <name>image_generator</name>
  <result>image.png</result>
</tool_use_result>

A: the image is generated as image.png

---
User: "What is the result of the following operation: 5 + 3 + 1294.678?"

A: I can use the python_interpreter tool to calculate the result of the operation.
<tool_use>
  <name>python_interpreter</name>
  <arguments>{"code": "5 + 3 + 1294.678"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>python_interpreter</name>
  <result>1302.678</result>
</tool_use_result>

A: The result of the operation is 1302.678.

---
User: "Which city has the highest population , Guangzhou or Shanghai?"

A: I can use the search tool to find the population of Guangzhou.
<tool_use>
  <name>search</name>
  <arguments>{"query": "Population Guangzhou"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>search</name>
  <result>Guangzhou has a population of 15 million inhabitants as of 2021.</result>
</tool_use_result>

A: I can use the search tool to find the population of Shanghai.
<tool_use>
  <name>search</name>
  <arguments>{"query": "Population Shanghai"}</arguments>
</tool_use>

User: <tool_use_result>
  <name>search</name>
  <result>26 million (2019)</result>
</tool_use_result>
Assistant: The population of Shanghai is 26 million, while Guangzhou has a population of 15 million. Therefore, Shanghai has the highest population.`

/**
 * 构建可用工具部分（提取自 Cherry Studio）
 */
function buildAvailableTools(tools: ToolSet): string {
  const availableTools = Object.keys(tools)
    .map((toolName: string) => {
      const tool = tools[toolName]
      return `
<tool>
  <name>${toolName}</name>
  <description>${tool.description || ''}</description>
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

/**
 * 默认的系统提示符构建函数（提取自 Cherry Studio）
 */
function defaultBuildSystemPrompt(userSystemPrompt: string, tools: ToolSet): string {
  const availableTools = buildAvailableTools(tools)

  const fullPrompt = DEFAULT_SYSTEM_PROMPT.replace('{{ TOOL_USE_EXAMPLES }}', DEFAULT_TOOL_USE_EXAMPLES)
    .replace('{{ AVAILABLE_TOOLS }}', availableTools)
    .replace('{{ USER_SYSTEM_PROMPT }}', userSystemPrompt || '')

  return fullPrompt
}

/**
 * 默认工具解析函数（提取自 Cherry Studio）
 * 解析 XML 格式的工具调用
 */
function defaultParseToolUse(content: string, tools: ToolSet): { results: ToolUseResult[]; content: string } {
  if (!content || !tools || Object.keys(tools).length === 0) {
    return { results: [], content: content }
  }

  // 支持两种格式：
  // 1. 完整的 <tool_use></tool_use> 标签包围的内容
  // 2. 只有内部内容（从 TagExtractor 提取出来的）

  let contentToProcess = content
  // 如果内容不包含 <tool_use> 标签，说明是从 TagExtractor 提取的内部内容，需要包装
  if (!content.includes('<tool_use>')) {
    contentToProcess = `<tool_use>\n${content}\n</tool_use>`
  }

  const toolUsePattern =
    /<tool_use>([\s\S]*?)<name>([\s\S]*?)<\/name>([\s\S]*?)<arguments>([\s\S]*?)<\/arguments>([\s\S]*?)<\/tool_use>/g
  const results: ToolUseResult[] = []
  let match
  let idx = 0

  // Find all tool use blocks
  while ((match = toolUsePattern.exec(contentToProcess)) !== null) {
    const fullMatch = match[0]
    const toolName = match[2].trim()
    const toolArgs = match[4].trim()

    // Try to parse the arguments as JSON
    let parsedArgs
    try {
      parsedArgs = JSON.parse(toolArgs)
    } catch (error) {
      // If parsing fails, use the string as is
      parsedArgs = toolArgs
    }

    // Find the corresponding tool
    const tool = tools[toolName]
    if (!tool) {
      console.warn(`Tool "${toolName}" not found in available tools`)
      continue
    }

    // Add to results array
    results.push({
      id: `${toolName}-${idx++}`, // Unique ID for each tool use
      toolName: toolName,
      arguments: parsedArgs,
      status: 'pending'
    })
    contentToProcess = contentToProcess.replace(fullMatch, '')
  }
  return { results, content: contentToProcess }
}

export const createPromptToolUsePlugin = (config: PromptToolUseConfig = {}) => {
  const { enabled = true, buildSystemPrompt = defaultBuildSystemPrompt, parseToolUse = defaultParseToolUse } = config

  return definePlugin({
    name: 'built-in:prompt-tool-use',
    transformParams: (params: any, context: AiRequestContext) => {
      if (!enabled || !params.tools || typeof params.tools !== 'object') {
        return params
      }

      context.mcpTools = params.tools
      console.log('tools stored in context', params.tools)

      // 构建系统提示符
      const userSystemPrompt = typeof params.system === 'string' ? params.system : ''
      const systemPrompt = buildSystemPrompt(userSystemPrompt, params.tools)
      let systemMessage: string | null = systemPrompt
      console.log('config.context', context)
      if (config.createSystemMessage) {
        // 🎯 如果用户提供了自定义处理函数，使用它
        systemMessage = config.createSystemMessage(systemPrompt, params, context)
      }

      // 移除 tools，改为 prompt 模式
      const transformedParams = {
        ...params,
        ...(systemMessage ? { system: systemMessage } : {}),
        tools: undefined
      }
      context.originalParams = transformedParams
      console.log('transformedParams', transformedParams)
      return transformedParams
    },
    transformStream: (_: any, context: AiRequestContext) => () => {
      let textBuffer = ''
      let stepId = ''

      if (!context.mcpTools) {
        throw new Error('No tools available')
      }

      // 创建工具执行器和流事件管理器
      const toolExecutor = new ToolExecutor()
      const streamEventManager = new StreamEventManager()

      type TOOLS = NonNullable<typeof context.mcpTools>
      return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
        async transform(
          chunk: TextStreamPart<TOOLS>,
          controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
        ) {
          // 收集文本内容
          if (chunk.type === 'text-delta') {
            textBuffer += chunk.text || ''
            stepId = chunk.id || ''
            controller.enqueue(chunk)
            return
          }

          if (chunk.type === 'text-end' || chunk.type === 'finish-step') {
            const tools = context.mcpTools
            if (!tools || Object.keys(tools).length === 0) {
              controller.enqueue(chunk)
              return
            }

            // 解析工具调用
            const { results: parsedTools, content: parsedContent } = parseToolUse(textBuffer, tools)
            const validToolUses = parsedTools.filter((t) => t.status === 'pending')

            // 如果没有有效的工具调用，直接传递原始事件
            if (validToolUses.length === 0) {
              controller.enqueue(chunk)
              return
            }

            if (chunk.type === 'text-end') {
              controller.enqueue({
                type: 'text-end',
                id: stepId,
                providerMetadata: {
                  text: {
                    value: parsedContent
                  }
                }
              })
              return
            }

            controller.enqueue({
              ...chunk,
              finishReason: 'tool-calls'
            })

            // 发送步骤开始事件
            streamEventManager.sendStepStartEvent(controller)

            // 执行工具调用
            const executedResults = await toolExecutor.executeTools(validToolUses, tools, controller)

            // 发送步骤完成事件
            streamEventManager.sendStepFinishEvent(controller, chunk)

            // 处理递归调用
            if (validToolUses.length > 0) {
              const toolResultsText = toolExecutor.formatToolResults(executedResults)
              const recursiveParams = streamEventManager.buildRecursiveParams(
                context,
                textBuffer,
                toolResultsText,
                tools
              )

              await streamEventManager.handleRecursiveCall(controller, recursiveParams, context, stepId)
            }

            // 清理状态
            textBuffer = ''
            return
          }

          // 对于其他类型的事件，直接传递
          controller.enqueue(chunk)
        },

        flush() {
          // 流结束时的清理工作
          console.log('[MCP Prompt] Stream ended, cleaning up...')
        }
      })
    }
  })
}
