import { generateMcpToolFunctionName } from '@shared/mcp'

export interface ToolInfo {
  name: string
  serverName?: string
  description?: string
}

/**
 * Hub Mode System Prompt - For native MCP tool calling
 * Used when model supports native function calling via MCP protocol
 */
const HUB_MODE_SYSTEM_PROMPT_BASE = `
## Hub MCP Tools – Code Execution Mode

You can discover and call MCP tools through the hub server using two meta-tools: **search** and **exec**.

### Critical Rules (Read First)

1. You MUST explicitly \`return\` the final value from your \`exec\` code. If you do not return a value, the result will be \`undefined\`.
2. All MCP tools are async functions. Always call them as \`await ToolName(params)\`.
3. Use the exact function names and parameter shapes returned by \`search\`.
4. You CANNOT call \`search\` or \`exec\` from inside \`exec\` code—use them only as MCP tools.
5. \`console.log\` output is NOT the result. Logs are separate; the final answer must come from \`return\`.

### Workflow

1. Call \`search\` with relevant keywords to discover tools.
2. Read the returned JavaScript function declarations and JSDoc to understand names and parameters.
3. Call \`exec\` with JavaScript code that uses the discovered tools and ends with an explicit \`return\`.
4. Use the \`exec\` result as your answer.

### What \`search\` Does

- Input: keyword string (comma-separated for OR-matching), plus optional \`limit\`.
- Output: JavaScript async function declarations with JSDoc showing exact function names, parameters, and return types.

### What \`exec\` Does

- Runs JavaScript code in an isolated async context (wrapped as \`(async () => { your code })())\`.
- All discovered tools are exposed as async functions: \`await ToolName(params)\`.
- Available helpers:
  - \`parallel(...promises)\` → \`Promise.all(promises)\`
  - \`settle(...promises)\` → \`Promise.allSettled(promises)\`
  - \`console.log/info/warn/error/debug\`
- Returns JSON with: \`result\` (your returned value), \`logs\` (optional), \`error\` (optional), \`isError\` (optional).

### Example: Single Tool Call

\`\`\`javascript
// Step 1: search({ query: "browser,fetch" })
// Step 2: exec with:
const page = await CherryBrowser_fetch({ url: "https://example.com" })
return page
\`\`\`

### Example: Multiple Tools with Parallel

\`\`\`javascript
const [forecast, time] = await parallel(
  Weather_getForecast({ city: "Paris" }),
  Time_getLocalTime({ city: "Paris" })
)
return { city: "Paris", forecast, time }
\`\`\`

### Example: Handle Partial Failures with Settle

\`\`\`javascript
const results = await settle(
  Weather_getForecast({ city: "Paris" }),
  Weather_getForecast({ city: "Tokyo" })
)
const successful = results.filter(r => r.status === "fulfilled").map(r => r.value)
return { results, successful }
\`\`\`

### Example: Error Handling

\`\`\`javascript
try {
  const user = await User_lookup({ email: "user@example.com" })
  return { found: true, user }
} catch (error) {
  return { found: false, error: String(error) }
}
\`\`\`

### Common Mistakes to Avoid

❌ **Forgetting to return** (result will be \`undefined\`):
\`\`\`javascript
const data = await SomeTool({ id: "123" })
// Missing return!
\`\`\`

✅ **Always return**:
\`\`\`javascript
const data = await SomeTool({ id: "123" })
return data
\`\`\`

❌ **Only logging, not returning**:
\`\`\`javascript
const data = await SomeTool({ id: "123" })
console.log(data)  // Logs are NOT the result!
\`\`\`

❌ **Missing await**:
\`\`\`javascript
const data = SomeTool({ id: "123" })  // Returns Promise, not value!
return data
\`\`\`

❌ **Awaiting before parallel**:
\`\`\`javascript
await parallel(await ToolA(), await ToolB())  // Wrong: runs sequentially
\`\`\`

✅ **Pass promises directly to parallel**:
\`\`\`javascript
await parallel(ToolA(), ToolB())  // Correct: runs in parallel
\`\`\`

### Best Practices

- Always call \`search\` first to discover tools and confirm signatures.
- Always use an explicit \`return\` at the end of \`exec\` code.
- Use \`parallel\` for independent operations that can run at the same time.
- Use \`settle\` when some calls may fail but you still want partial results.
- Prefer a single \`exec\` call for multi-step flows.
- Treat \`console.*\` as debugging only, never as the primary result.
`

/**
 * Auto Mode System Prompt - For XML tool_use format
 * Used when model needs explicit XML format to invoke tools
 * Only teaches search and exec tools
 */
const AUTO_MODE_SYSTEM_PROMPT_BASE = `
You can discover and invoke MCP tools through a hub using TWO meta-tools: \`search\` and \`exec\`.

## Tool Invocation Format

When you want to call a tool, output exactly one XML block:

<tool_use>
  <name>{tool_name}</name>
  <arguments>{json_arguments}</arguments>
</tool_use>

Rules:
- \`{tool_name}\` MUST be either \`search\` or \`exec\`
- \`<arguments>\` MUST contain valid JSON (no comments, no trailing commas)
- Do NOT include extra text before or after the \`<tool_use>\` block

## Available Tools

1. **search** - Discover MCP tools by keyword
   \`\`\`json
   { "query": "keyword1,keyword2", "limit": 10 }
   \`\`\`
   Returns JavaScript function declarations with JSDoc showing names, parameters, and return types.

2. **exec** - Execute JavaScript that calls discovered tools
   \`\`\`json
   { "code": "const r = await ToolName({...}); return r;" }
   \`\`\`
   **CRITICAL:** You MUST \`return\` the final value, or result will be \`undefined\`.

## Workflow

1. Call \`search\` with keywords to discover tools
2. Read the returned function signatures carefully
3. Call \`exec\` with JavaScript code that:
   - Uses ONLY functions returned by \`search\`
   - Calls them with \`await\`
   - Ends with explicit \`return\`
4. Answer the user based on the result

## Example

User: "Calculate 15 * 7"

Assistant calls search:
<tool_use>
  <name>search</name>
  <arguments>{"query": "python,calculator"}</arguments>
</tool_use>

Hub returns function signature:
\`\`\`js
async function CherryPython_pythonExecute(params: { code: string }): Promise<unknown>
\`\`\`

Assistant calls exec:
<tool_use>
  <name>exec</name>
  <arguments>{"code": "const result = await CherryPython_pythonExecute({ code: '15 * 7' }); return result;"}</arguments>
</tool_use>

Hub returns: { "result": 105 }

Assistant answers: "15 × 7 = 105"

## Common Mistakes

❌ Forgetting to return (result will be undefined):
\`\`\`js
await SomeTool({ id: "123" })
\`\`\`

✅ Always return:
\`\`\`js
const data = await SomeTool({ id: "123" }); return data;
\`\`\`

❌ Calling exec before search - you must discover tools first

❌ Using functions not returned by search
`

function buildToolsSection(tools: ToolInfo[]): string {
  const existingNames = new Set<string>()
  return tools
    .map((t) => {
      const functionName = generateMcpToolFunctionName(t.serverName, t.name, existingNames)
      const desc = t.description || ''
      const normalizedDesc = desc.replace(/\s+/g, ' ').trim()
      const truncatedDesc = normalizedDesc.length > 50 ? `${normalizedDesc.slice(0, 50)}...` : normalizedDesc
      return `- ${functionName}: ${truncatedDesc}`
    })
    .join('\n')
}

/**
 * Get system prompt for Hub Mode (native MCP tool calling)
 */
export function getHubModeSystemPrompt(tools: ToolInfo[] = []): string {
  if (tools.length === 0) {
    return ''
  }

  const toolsSection = buildToolsSection(tools)

  return `${HUB_MODE_SYSTEM_PROMPT_BASE}
### Available Tools
${toolsSection}
`
}

/**
 * Get system prompt for Auto Mode (XML tool_use format)
 */
export function getAutoModeSystemPrompt(tools: ToolInfo[] = []): string {
  if (tools.length === 0) {
    return ''
  }

  const toolsSection = buildToolsSection(tools)

  return `${AUTO_MODE_SYSTEM_PROMPT_BASE}
## Discoverable Tools (use search to get full signatures)
${toolsSection}
`
}
