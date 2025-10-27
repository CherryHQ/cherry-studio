/**
 * 内置插件：MCP Prompt 模式
 * 为不支持原生 Function Call 的模型提供 prompt 方式的工具调用
 * 内置默认逻辑，支持自定义覆盖
 */
import type { TextStreamPart, ToolSet } from 'ai'

import { definePlugin } from '../../index'
import type { AiRequestContext } from '../../types'
import { StreamEventManager } from './StreamEventManager'
import { type TagConfig, TagExtractor } from './tagExtraction'
import { ToolExecutor } from './ToolExecutor'
import { PromptToolUseConfig, ToolUseResult } from './type'

/**
 * 工具使用标签配置
 */
const TOOL_USE_TAG_CONFIG: TagConfig = {
  openingTag: '<tool_use>',
  closingTag: '</tool_use>',
  separator: '\n'
}

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
function buildAvailableTools(tools: ToolSet): string | null {
  const availableTools = Object.keys(tools)
  if (availableTools.length === 0) return null
  const result = availableTools
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
${result}
</tools>`
}

/**
 * 默认的系统提示符构建函数（提取自 Cherry Studio）
 */
function defaultBuildSystemPrompt(userSystemPrompt: string, tools: ToolSet): string {
  const availableTools = buildAvailableTools(tools)
  if (availableTools === null) return userSystemPrompt

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

      // 分离 provider-defined 和其他类型的工具
      const providerDefinedTools: ToolSet = {}
      const promptTools: ToolSet = {}

      for (const [toolName, tool] of Object.entries(params.tools as ToolSet)) {
        if (tool.type === 'provider-defined') {
          // provider-defined 类型的工具保留在 tools 参数中
          providerDefinedTools[toolName] = tool
        } else {
          // 其他工具转换为 prompt 模式
          promptTools[toolName] = tool
        }
      }

      // 只有当有非 provider-defined 工具时才保存到 context
      if (Object.keys(promptTools).length > 0) {
        context.mcpTools = promptTools
      }

      // 构建系统提示符（只包含非 provider-defined 工具）
      const userSystemPrompt = typeof params.system === 'string' ? params.system : ''
      const systemPrompt = buildSystemPrompt(userSystemPrompt, promptTools)
      let systemMessage: string | null = systemPrompt
      if (config.createSystemMessage) {
        // 🎯 如果用户提供了自定义处理函数，使用它
        systemMessage = config.createSystemMessage(systemPrompt, params, context)
      }

      // 保留 provider-defined tools，移除其他 tools
      const transformedParams = {
        ...params,
        ...(systemMessage ? { system: systemMessage } : {}),
        tools: Object.keys(providerDefinedTools).length > 0 ? providerDefinedTools : undefined
      }
      context.originalParams = transformedParams
      return transformedParams
    },
    transformStream: (_: any, context: AiRequestContext) => () => {
      let textBuffer = ''
      // let stepId = ''

      // 如果没有需要 prompt 模式处理的工具，直接返回原始流
      if (!context.mcpTools) {
        return new TransformStream()
      }

      // 从 context 中获取或初始化 usage 累加器
      if (!context.accumulatedUsage) {
        context.accumulatedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0
        }
      }

      // 创建工具执行器、流事件管理器和标签提取器
      const toolExecutor = new ToolExecutor()
      const streamEventManager = new StreamEventManager()
      const tagExtractor = new TagExtractor(TOOL_USE_TAG_CONFIG)

      // 在context中初始化工具执行状态，避免递归调用时状态丢失
      if (!context.hasExecutedToolsInCurrentStep) {
        context.hasExecutedToolsInCurrentStep = false
      }

      // 用于hold text-start事件，直到确认有非工具标签内容
      let pendingTextStart: TextStreamPart<TOOLS> | null = null
      let hasStartedText = false

      type TOOLS = NonNullable<typeof context.mcpTools>
      return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
        async transform(
          chunk: TextStreamPart<TOOLS>,
          controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
        ) {
          // Hold住text-start事件，直到确认有非工具标签内容
          if ((chunk as any).type === 'text-start') {
            pendingTextStart = chunk
            return
          }

          // text-delta阶段：收集文本内容并过滤工具标签
          if (chunk.type === 'text-delta') {
            textBuffer += chunk.text || ''
            // stepId = chunk.id || ''

            // 使用TagExtractor过滤工具标签，只传递非标签内容到UI层
            const extractionResults = tagExtractor.processText(chunk.text || '')

            for (const result of extractionResults) {
              // 只传递非标签内容到UI层
              if (!result.isTagContent && result.content) {
                // 如果还没有发送text-start且有pending的text-start，先发送它
                if (!hasStartedText && pendingTextStart) {
                  controller.enqueue(pendingTextStart)
                  hasStartedText = true
                  pendingTextStart = null
                }

                const filteredChunk = {
                  ...chunk,
                  text: result.content
                }
                controller.enqueue(filteredChunk)
              }
            }
            return
          }

          if (chunk.type === 'text-end') {
            // 只有当已经发送了text-start时才发送text-end
            if (hasStartedText) {
              controller.enqueue(chunk)
            }
            return
          }

          if (chunk.type === 'finish-step') {
            // 统一在finish-step阶段检查并执行工具调用
            const tools = context.mcpTools
            if (tools && Object.keys(tools).length > 0 && !context.hasExecutedToolsInCurrentStep) {
              // 解析完整的textBuffer来检测工具调用
              const { results: parsedTools } = parseToolUse(textBuffer, tools)
              const validToolUses = parsedTools.filter((t) => t.status === 'pending')

              if (validToolUses.length > 0) {
                context.hasExecutedToolsInCurrentStep = true

                // 执行工具调用（不需要手动发送 start-step，外部流已经处理）
                const executedResults = await toolExecutor.executeTools(validToolUses, tools, controller)

                // 发送步骤完成事件，使用 tool-calls 作为 finishReason
                streamEventManager.sendStepFinishEvent(controller, chunk, context, 'tool-calls')

                // 处理递归调用
                const toolResultsText = toolExecutor.formatToolResults(executedResults)
                const recursiveParams = streamEventManager.buildRecursiveParams(
                  context,
                  textBuffer,
                  toolResultsText,
                  tools
                )

                await streamEventManager.handleRecursiveCall(controller, recursiveParams, context)
                return
              }
            }

            // 如果没有执行工具调用，直接传递原始finish-step事件
            controller.enqueue(chunk)

            // 清理状态
            textBuffer = ''
            return
          }

          // 处理 finish 类型，使用累加后的 totalUsage
          if (chunk.type === 'finish') {
            controller.enqueue({
              ...chunk,
              totalUsage: context.accumulatedUsage
            })
            return
          }

          // 对于其他类型的事件，直接传递（不包括text-start，已在上面处理）
          if ((chunk as any).type !== 'text-start') {
            controller.enqueue(chunk)
          }
        },

        flush() {
          // 清理pending状态
          pendingTextStart = null
          hasStartedText = false
        }
      })
    }
  })
}
