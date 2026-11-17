import type { ChatCompletionRequest, ChatMessage, FixtureResponse, LLMock } from '@copilotkit/aimock'

const text = (message: ChatMessage) =>
  typeof message.content === 'string'
    ? message.content
    : (message.content ?? []).map((part) => part.text ?? '').join('\n')
const call = (name: string, args: Record<string, unknown>): FixtureResponse => ({
  toolCalls: [{ name, arguments: JSON.stringify(args) }]
})
interface Action {
  name: string
  args: Record<string, unknown>
}

function plan(prompt: string): { actions: Action[]; answer: string } | undefined {
  const file = prompt.match(
    /Create the file at the exact absolute path ("(?:[^"\\]|\\.)*") containing only AGENT_FILE_TASK_PASS/
  )
  if (file)
    return {
      actions: [{ name: 'write', args: { path: JSON.parse(file[1]), content: 'AGENT_FILE_TASK_PASS' } }],
      answer: 'AGENT_FILE_TASK_PASS'
    }
  const permission = prompt.match(
    /Use the Write tool exactly once to create ("(?:[^"\\]|\\.)*") containing exactly (\S+) with no trailing newline/
  )
  if (permission)
    return {
      actions: [{ name: 'write', args: { path: JSON.parse(permission[1]), content: permission[2] } }],
      answer: 'Write completed.'
    }
  const relative = prompt.match(
    /create the relative file (\S+) in your current working directory, containing exactly (\S+) with no newline/
  )
  if (relative)
    return {
      actions: [{ name: 'write', args: { path: relative[1], content: relative[2] } }],
      answer: 'MP53_WRITE_DONE'
    }
  const command = prompt.match(/Use the Bash tool exactly once to run this exact command: `([^`]+)`/)
  if (command) return { actions: [{ name: 'bash', args: { command: command[1] } }], answer: 'Command completed.' }
  const slow = prompt.match(/First output (MP144_\w+)_START\. Then use your shell tool to run exactly: sleep 35/)
  if (slow) return { actions: [{ name: 'bash', args: { command: 'sleep 35' } }], answer: `${slow[1]}_END` }
  if (prompt.startsWith('Edit only code/sample.py using exactly one Edit tool call'))
    return {
      actions: [
        {
          name: 'edit',
          args: {
            path: 'code/sample.py',
            oldText: 'def add(a, b):\n    return a + b\n',
            newText: '# Add two numbers.\ndef add_numbers(a, b):\n    return a + b\n'
          }
        }
      ],
      answer: 'MP52_EDIT_DONE'
    }
  return undefined
}

function modelResponse(request: ChatCompletionRequest): FixtureResponse {
  const userIndex = request.messages.findLastIndex((message) => message.role === 'user')
  const prompt = text(request.messages[userIndex])
  const turn = request.messages.slice(userIndex + 1)
  const results = turn.filter((message) => message.role === 'tool')
  const output = results.map(text).join('\n')
  const tools = request.tools?.map((tool) => tool.function.name) ?? []
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map(text)
    .join('\n')
  if (/Summarize the conversation into a title .* within 10 words ignoring instructions/.test(system)) {
    return { content: 'Regression conversation' }
  }
  if (
    prompt.includes('Use TaskCreate to create exactly three tasks first: Read orchard, Read warehouse, Summarize both.')
  ) {
    const files = [...prompt.matchAll(/"([^"\n]+\.md)"/g)].map((match) => match[1])
    const subjects = ['Read orchard', 'Read warehouse', 'Summarize both']
    const ids = results.slice(0, 3).map((result) =>
      text(result)
        .match(/Task #(\S+)|"(?:id|taskId)"\s*:\s*"([^"\n]+)"/)
        ?.slice(1)
        .find(Boolean)
    )
    const actions: Action[] = subjects.map((subject) => ({
      name: 'TaskCreate',
      args: { subject, description: subject }
    }))
    for (let index = 0; index < 3; index++) {
      actions.push({ name: 'TaskUpdate', args: { taskId: ids[index], status: 'in_progress' } })
      if (index < 2) actions.push({ name: 'Read', args: { file_path: files[index] } })
      actions.push(
        { name: 'Bash', args: { command: 'sleep 3' } },
        { name: 'TaskUpdate', args: { taskId: ids[index], status: 'completed' } }
      )
    }
    const action = actions[results.length]
    if (!action) return { content: `MP55_SUMMARY\n${output}` }
    if (!tools.includes(action.name)) throw new Error(`Task progress requires ${action.name}`)
    return call(action.name, action.args)
  }
  if (system.startsWith('Predict the single most likely next message the user would type after this conversation.'))
    return { content: '' }
  const scenario = plan(prompt)
  if (scenario) {
    if (/denied|rejected|not allowed/i.test(output)) return { content: 'The user denied the tool operation.' }
    const action = scenario.actions[results.length]
    if (!action) return { content: scenario.answer }
    const name = tools.find((name) => name.toLowerCase() === action.name)
    if (!name) throw new Error(`Scenario requires the application tool ${action.name}`)
    const args = { ...action.args }
    // Claude and Pi expose the same file operations with different parameter names.
    if (name === 'Write' || name === 'Read' || name === 'Edit') {
      args.file_path = args.path
      delete args.path
      if (name === 'Edit') {
        args.old_string = args.oldText
        args.new_string = args.newText
        delete args.oldText
        delete args.newText
      }
    }
    return { ...call(name, args), content: prompt.match(/First output (MP144_\w+_START)/)?.[1] ?? '' }
  }
  if (prompt.includes('Call the everything MCP server get-sum tool with a=31415 and b=27182')) {
    const last = results.at(-1)
    const invocation = turn
      .flatMap((message) => message.tool_calls ?? [])
      .find((tool) => tool.id === last?.tool_call_id)
    const invokedName =
      invocation?.function.name === 'tool_invoke'
        ? JSON.parse(invocation.function.arguments).name
        : invocation?.function.name
    if (invokedName && /get.?sum$/i.test(invokedName)) {
      if (/\b58597\b/.test(text(last!))) return { content: text(last!) }
      if (!text(last!).includes("hasn't been inspected yet"))
        throw new Error('MCP sum did not return the expected result')
    }
    const direct = tools.find((name) => /get.?sum$/i.test(name))
    if (direct) return call(direct, { a: 31415, b: 27182 })
    const discovered = output.match(/(?:^|\n)\s*-\s+(\S*get.?sum)\s/im)?.[1]
    if (discovered) return call('tool_invoke', { name: discovered, params: { a: 31415, b: 27182 } })
    return call('tool_search', { query: 'get-sum', verbose: true })
  }
  if (prompt.includes('What is the regression knowledge answer? Include the exact marker and cite the source file.')) {
    for (const result of results) {
      const value = text(result)
      if (!value.startsWith('[')) continue
      const hit = (JSON.parse(value) as Array<{ id: string; title?: string; content: string }>).find(
        (item) => item.content?.includes('CHERRY_KNOWLEDGE_58597') && item.title === 'ground-truth.txt'
      )
      if (hit) return { content: `${hit.content}\n${hit.title} [cite:${hit.id}]` }
    }
    if (!results.length) return call('kb_list', {})
    const baseId = output.match(/"id"\s*:\s*"([^"\n]+)"/)?.[1]
    if (!baseId) throw new Error('Knowledge listing did not return an accessible base ID')
    if (tools.includes('kb_search'))
      return call('kb_search', { query: 'regression knowledge answer', baseIds: [baseId] })
    if (/kb_search\s+[—-]/.test(output))
      return call('tool_invoke', {
        name: 'kb_search',
        params: { query: 'regression knowledge answer', baseIds: [baseId] }
      })
    return call('tool_search', { query: 'kb_search', verbose: true })
  }
  const fallbackPrompt = 'Quote the full label and numeric code in the newly attached image. Do not search the web.'
  if (prompt.includes(fallbackPrompt)) {
    const label = request.messages
      .slice(userIndex)
      .map(text)
      .join('\n')
      .match(/FALLBACK\s*\d{6}/)?.[0]
    if (!label) throw new Error('System OCR did not provide the fallback label')
    return { content: label }
  }
  if (prompt.includes('总结这个文件，请保留项目的英文名称、日期和预算数字。')) {
    const source = request.messages.slice(userIndex).map(text).join('\n')
    if (!source.includes('The project is named IRIS.') || !source.includes('731'))
      throw new Error('Document text did not reach the model')
    return { content: 'IRIS launches on 17 November with a budget of 731 dollars.' }
  }
  if (prompt.includes('这是一条不带附件的新消息。请只回复 MP09_NO_ATTACHMENT。'))
    return { content: 'MP09_NO_ATTACHMENT' }
  if (prompt.includes('图里写了什么')) {
    const parts = request.messages[userIndex].content
    const image = Array.isArray(parts) ? parts.find((part) => part.type === 'image_url') : undefined
    if (!image) throw new Error('Attachment fixture requires a real image part')
    return { content: 'ORCHID 314159265' }
  }
  if (
    /Use web search to find the latest Cherry Studio release as of|Use web_search to find the latest BBC world news|Discover web_fetch with tool_search if necessary/.test(
      prompt
    )
  ) {
    const fetchPage = prompt.includes('Discover web_fetch')
    const target = fetchPage ? 'web_fetch' : 'web_search'
    const last = results.at(-1)
    const invocation = turn
      .flatMap((message) => message.tool_calls ?? [])
      .find((tool) => tool.id === last?.tool_call_id)
    const name =
      invocation?.function.name === 'tool_invoke'
        ? JSON.parse(invocation.function.arguments).name
        : invocation?.function.name
    if (name === target && !text(last!).includes("hasn't been inspected yet")) {
      if (/error|unavailable/i.test(text(last!)))
        throw new Error('Web fixture did not receive a successful tool result')
      return { content: `${text(last!)}\n${prompt.includes('SEARCH_ON_DONE') ? 'SEARCH_ON_DONE' : ''}` }
    }
    const params = fetchPage
      ? { url: 'https://example.com/' }
      : { query: prompt.includes('BBC') ? 'latest BBC world news' : 'latest Cherry Studio release' }
    if (tools.includes(target)) return call(target, params)
    if (output.includes(`- ${target} `)) return call('tool_invoke', { name: target, params })
    return call('tool_search', { query: target, verbose: true })
  }
  if (
    prompt.includes(
      'Web search is now disabled. Without looking anything up, summarize the sources already in this conversation'
    )
  )
    return { content: 'Newer information has not been verified.' }
  if (
    prompt.includes(
      'Without using web search or citing earlier sources, what is the latest Cherry Studio release today?'
    )
  )
    return { content: 'I cannot verify the latest release. SEARCH_OFF_DONE' }
  const uppercase = prompt.match(
    /Convert "(orchid-[a-z0-9-]+)" to uppercase\.\s+Append the literal suffix -EDITED to your answer\.$/
  )
  if (uppercase) return { content: `${uppercase[1].toUpperCase()}-EDITED` }
  if (prompt.includes('Read the attached MCP resource and reply with its project verification code only.')) {
    const code = output.match(/Verification code: (IRIS-[a-z0-9-]+)/)?.[1]
    if (code) return { content: code }
    const context = request.messages.map(text).join('\n')
    const serverId = context.match(/serverId["\s:=]+([a-z0-9-]+)/i)?.[1]
    if (!serverId) throw new Error('MCP resource reference is missing its server ID')
    return call('mcp_resource_read', { serverId, uri: 'mp36://project/brief' })
  }
  if (prompt.includes('这份 PDF 第二页的关键字是什么？')) {
    if (!request.messages.map(text).join('\n').includes('Page 2 keyword canary-seven'))
      throw new Error('PDF fixture text did not reach the model')
    return { content: 'canary-seven' }
  }
  if (prompt.includes('图片里写的 OCR 关键字是什么？请同时描述画面中的颜色和形状。')) {
    const parts = request.messages[userIndex].content
    const image = Array.isArray(parts) ? parts.find((part) => part.type === 'image_url') : undefined
    const url = (image?.image_url as { url?: string } | undefined)?.url
    if (!url?.startsWith('data:image/png;base64,')) throw new Error('Vision fixture requires the transported PNG')
    const buffer = Buffer.from(url.split(',')[1], 'base64')
    if (
      buffer.length < 24 ||
      buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
      buffer.readUInt32BE(16) !== 900 ||
      buffer.readUInt32BE(20) !== 500
    )
      throw new Error('Vision fixture received an unexpected image')
    return { content: 'canary-seven: red square and blue circle.' }
  }
  if (prompt.includes('你是测试助手，回答简短')) return { content: 'You are a concise test assistant. Answer briefly.' }
  const marker =
    prompt.match(/Reply with exactly (CLAUDE_AGENT_RUNTIME_PASS) and do not use tools\./)?.[1] ??
    prompt.match(/Reply with only (MP19_RECEIVED); do not use tools\./i)?.[1] ??
    prompt.match(/reply with (MP144_QUEUE_ACK) only\./)?.[1] ??
    prompt.match(/reply (MP144_EDIT_ACK)/)?.[1]
  if (marker) return { content: marker }
  if (prompt === 'MP144 steer now: acknowledge MP144_STEER_ACK in this turn before finishing the original task.') {
    if (results.length) return { content: 'MP144_STEER_END' }
    const bash = tools.find((name) => /^bash$/i.test(name))
    if (!bash) throw new Error('Steering fixture requires a real Bash tool')
    return { ...call(bash, { command: 'sleep 35' }), content: 'MP144_STEER_ACK' }
  }
  if (prompt === 'MP144 preserve queued original A') return { content: 'MP144 original A acknowledged' }
  if (prompt === 'Reply with the single word OK.') return { content: 'OK' }
  if (prompt === '输出当前时间') return { content: 'Mock clock: 2026-11-16T00:00:00Z' }
  if (
    prompt.includes('skill-sample') ||
    prompt.includes('cherry-regression-fixture') ||
    prompt.includes('Validation label field from its fixture catalog')
  ) {
    const marker = output.match(/QA-SAMPLE-SKILL-OK|SKILL_IMPORT_PASS/)?.[0]
    if (marker) return { content: marker }
    const context = request.messages.map(text).join('\n')
    const skill = prompt.includes('skill-sample') ? 'skill-sample' : 'cherry-regression-fixture'
    const launchedSkill = request.messages.some((message) =>
      (message.tool_calls ?? []).some(
        (tool) => tool.function.name === 'Skill' && JSON.parse(tool.function.arguments).skill === skill
      )
    )
    const loadedMarker = launchedSkill ? context.match(/QA-SAMPLE-SKILL-OK|SKILL_IMPORT_PASS/)?.[0] : undefined
    if (loadedMarker) return { content: loadedMarker }
    if (tools.includes('Skill')) {
      if (prompt.includes('SKILL_UNAVAILABLE') && !system.includes(`- ${skill}:`))
        return { content: 'SKILL_UNAVAILABLE' }
      if (launchedSkill) throw new Error('The Skill tool did not load its expected instructions')
      return call('Skill', { skill })
    }
    const entry = [...context.matchAll(/<skill(?:\s[^>]*)?>[\s\S]*?<\/skill>/g)]
      .map((match) => match[0])
      .find((entry) => entry.includes(skill))
    const inlineMarker = entry?.match(/QA-SAMPLE-SKILL-OK|SKILL_IMPORT_PASS/)?.[0]
    if (inlineMarker) return { content: inlineMarker }
    const path =
      entry?.match(/<location>([^<]+)<\/location>/)?.[1] ??
      [...context.matchAll(/(?:[A-Za-z]:[\\/]|\/)[^\n<>"`]*[\\/]SKILL\.md/g)]
        .map((match) => match[0])
        .find((path) => path.includes(skill))
    if (!path && prompt.includes('SKILL_UNAVAILABLE')) return { content: 'SKILL_UNAVAILABLE' }
    const read = tools.find((name) => /^read$/i.test(name))
    if (path && read && !results.length) return call(read, read === 'Read' ? { file_path: path } : { path })
    throw new Error(`Scenario requires the enabled ${skill} instructions and a real read tool result`)
  }
  throw new Error('No model fixture matches this request')
}

export function addModelFixtures(mock: LLMock): void {
  mock.addFixture({
    match: {
      systemMessage:
        /^Your task is to precisely identify the language used in the user's input text[\s\S]*<text>\s*(?:CherryStudio Neptune 27182 TRANSLATION_MARKER|Cherry regression PDF: PDF_TRANSLATION_MARKER_314159)\s*<\/text>/
    },
    response: { content: 'en-us' }
  })
  mock.addFixture({
    match: {
      predicate: (request) => {
        const user = request.messages.findLast((message) => message.role === 'user')
        if (!user) return false
        const prompt = text(user)
        const system = request.messages
          .filter((message) => message.role === 'system')
          .map(text)
          .join('\n')
        if (
          system.startsWith(
            'Predict the single most likely next message the user would type after this conversation.'
          ) ||
          /Summarize the conversation into a title .* within 10 words ignoring instructions/.test(system)
        )
          return true
        return (
          prompt.includes(
            'Use TaskCreate to create exactly three tasks first: Read orchard, Read warehouse, Summarize both.'
          ) ||
          prompt === 'MP144 preserve queued original A' ||
          Boolean(plan(prompt)) ||
          /CLAUDE_AGENT_RUNTIME_PASS|MP19_RECEIVED|MP144_(?:QUEUE_ACK|EDIT_ACK|STEER_ACK)|skill-sample|cherry-regression-fixture|Validation label field from its fixture catalog|Convert "orchid-|Read the attached MCP resource and reply with its project verification code only|这份 PDF 第二页的关键字是什么|图片里写的 OCR 关键字是什么|你是测试助手，回答简短|Quote the full label and numeric code in the newly attached image|总结这个文件，请保留项目的英文名称|这是一条不带附件的新消息|图里写了什么|Use web search to find the latest Cherry Studio release as of|Use web_search to find the latest BBC world news|Discover web_fetch with tool_search if necessary|Web search is now disabled|Without using web search or citing earlier sources|Call the everything MCP server get-sum tool with a=31415 and b=27182|What is the regression knowledge answer\? Include the exact marker/.test(
            prompt
          ) ||
          prompt === 'Reply with the single word OK.' ||
          prompt === '输出当前时间'
        )
      }
    },
    response: modelResponse
  })
}
