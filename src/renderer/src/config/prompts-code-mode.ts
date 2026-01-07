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

You can discover and call MCP tools through the hub server using **ONLY two meta-tools**: **search** and **exec**.

### ⚠️ IMPORTANT: You can ONLY call these two tools directly

| Tool | Purpose |
|------|---------|
| \`search\` | Discover available tools and their signatures |
| \`exec\` | Execute JavaScript code that calls the discovered tools |

**All other tools (listed in "Discoverable Tools" below) can ONLY be called from INSIDE \`exec\` code.**
You CANNOT call them directly as tool calls. They are async functions available within the \`exec\` runtime.

### Critical Rules (Read First)

1. **ONLY \`search\` and \`exec\` are callable as tools.** All other tools must be used inside \`exec\` code.
2. You MUST explicitly \`return\` the final value from your \`exec\` code. If you do not return a value, the result will be \`undefined\`.
3. All MCP tools inside \`exec\` are async functions. Always call them as \`await ToolName(params)\`.
4. Use the exact function names and parameter shapes returned by \`search\`.
5. You CANNOT call \`search\` or \`exec\` from inside \`exec\` code—use them only as direct tool calls.
6. \`console.log\` output is NOT the result. Logs are separate; the final answer must come from \`return\`.

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

export function getHubModeSystemPrompt(tools: ToolInfo[] = []): string {
  if (tools.length === 0) {
    return ''
  }

  const toolsSection = buildToolsSection(tools)

  return `${HUB_MODE_SYSTEM_PROMPT_BASE}
## Discoverable Tools (ONLY usable inside \`exec\` code, NOT as direct tool calls)

The following tools are available inside \`exec\`. Use \`search\` to get their full signatures.
Do NOT call these directly—wrap them in \`exec\` code.

${toolsSection}
`
}
