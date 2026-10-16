# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 07-integrations.test.ts >> [MCP-01] Create and use Everything MCP
- Location: tests/e2e/regression/07-integrations.test.ts:33:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Connected', { exact: true })
Expected: visible
Timeout: 120000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 120000ms
  - waiting for getByText('Connected', { exact: true })

```

```yaml
- main
- dialog "Start failed":
  - heading "Start failed" [level=2]
  - text: Connection closed
  - button "Confirm"
```

# Test source

```ts
  1   | import { join } from 'node:path'
  2   | 
  3   | import { caseDefinition } from '../../../scripts/e2e/regression/cases'
  4   | import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
  5   | import type { Message } from '../../../src/shared/data/types/message'
  6   | import { startNewAgentTask } from './agents'
  7   | import { customAssistantName, ensureCustomAssistant } from './assistants'
  8   | import { sendChatMarker } from './chat'
  9   | import { expect, test } from './fixture'
  10  | import { ensureCustomChatProvider, selectVisibleModel } from './models'
  11  | import { dismissOnboarding, selectSidebarApp } from './navigation'
  12  | import { closeSettings, openSettingsSection } from './settings'
  13  | 
  14  | async function openSkillsPanel(page: Parameters<typeof selectSidebarApp>[0]): Promise<void> {
  15  |   const direct = page.locator('[data-ui~="chat.composer"]:visible').getByRole('button', { name: 'Skills', exact: true })
  16  |   await expect(direct).toBeVisible({ timeout: 30_000 })
  17  |   const manageSkills = page.getByText('Manage skills', { exact: true })
  18  |   await expect
  19  |     .poll(
  20  |       async () => {
  21  |         if (await manageSkills.isVisible().catch(() => false)) return true
  22  |         await direct.click()
  23  |         return manageSkills
  24  |           .waitFor({ state: 'visible', timeout: 2_000 })
  25  |           .then(() => true)
  26  |           .catch(() => false)
  27  |       },
  28  |       { timeout: 10_000 }
  29  |     )
  30  |     .toBe(true)
  31  | }
  32  | 
  33  | test(...caseDefinition('MCP-01'), async ({ app, mainWindow: page }) => {
  34  |   await openSettingsSection(page, 'MCP')
  35  |   if (
  36  |     !(await page
  37  |       .getByText('everything', { exact: true })
  38  |       .isVisible()
  39  |       .catch(() => false))
  40  |   ) {
  41  |     await page.getByRole('button', { name: 'Add', exact: true }).click()
  42  |     await page.getByText('Quick Create', { exact: true }).click()
  43  |     await page.getByPlaceholder('Name').fill('everything')
  44  |     await page.getByLabel('Command*').fill('npx')
  45  |     await page.getByLabel('Arguments').last().fill('--offline\n-y\n@modelcontextprotocol/server-everything@1.0.0')
  46  |     await page.getByRole('button', { name: 'Add', exact: true }).click()
  47  |   }
  48  |   await page
  49  |     .getByText(/everything STDIO|everything/, { exact: true })
  50  |     .first()
  51  |     .click()
  52  |   const enabled = page.getByRole('switch').first()
  53  |   if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
> 54  |   await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 2 * 60_000 })
      |                                                              ^ Error: expect(locator).toBeVisible() failed
  55  |   await page.getByRole('radio', { name: /Tools/ }).click()
  56  |   await expect(page.getByText('get-sum', { exact: true })).toBeVisible()
  57  |   await expect(page.getByText('echo', { exact: true })).toBeVisible()
  58  |   await closeSettings(page)
  59  | 
  60  |   await ensureCustomAssistant(app, page)
  61  |   await page.getByRole('button', { name: `Edit Assistant: ${customAssistantName(app)}`, exact: true }).click()
  62  |   await page.getByRole('tab', { name: 'MCP', exact: true }).click()
  63  |   await page.getByRole('radio', { name: 'Manual', exact: true }).click()
  64  |   const server = page.getByRole('switch', { name: 'everything', exact: true })
  65  |   if ((await server.getAttribute('aria-checked')) !== 'true') await server.click()
  66  |   await page.getByRole('button', { name: 'Close', exact: true }).click()
  67  | 
  68  |   const messageId = await sendChatMarker(
  69  |     page,
  70  |     'Call the everything MCP server get-sum tool with a=31415 and b=27182, then report its result.',
  71  |     '58597',
  72  |     false
  73  |   )
  74  |   await expect
  75  |     .poll(
  76  |       () =>
  77  |         page.evaluate(async (id) => {
  78  |           const response = await window.api.dataApi.request({
  79  |             id: `regression-mcp-result-${Date.now()}`,
  80  |             method: 'GET',
  81  |             path: `/messages/${id}`
  82  |           })
  83  |           const message = response.data as Message | undefined
  84  |           if (message?.role !== 'assistant' || message.status !== 'success') return false
  85  |           return (
  86  |             message.data.parts?.some((part) => {
  87  |               if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) return false
  88  |               if (!('state' in part) || part.state !== 'output-available') return false
  89  |               const input = part.input as { a?: number; b?: number } | undefined
  90  |               const output = part.output as
  91  |                 | {
  92  |                     isError?: boolean
  93  |                     metadata?: { type?: string; name?: string; serverName?: string }
  94  |                     content?: { type: string; text?: string }[]
  95  |                   }
  96  |                 | undefined
  97  |               return (
  98  |                 input?.a === 31415 &&
  99  |                 input.b === 27182 &&
  100 |                 output?.isError !== true &&
  101 |                 output?.metadata?.type === 'mcp' &&
  102 |                 output.metadata.name === 'get-sum' &&
  103 |                 output.metadata.serverName === 'everything' &&
  104 |                 output.content?.some((item) => item.type === 'text' && /\b58597\b/.test(item.text ?? ''))
  105 |               )
  106 |             }) ?? false
  107 |           )
  108 |         }, messageId),
  109 |       { timeout: 30_000, message: 'This response must contain a successful everything/get-sum execution' }
  110 |     )
  111 |     .toBe(true)
  112 | 
  113 |   page = await app.restart('authenticated')
  114 |   await dismissOnboarding(page)
  115 |   await openSettingsSection(page, 'MCP')
  116 |   await page
  117 |     .getByText(/everything STDIO|everything/, { exact: true })
  118 |     .first()
  119 |     .click()
  120 |   const restartedEnabled = page.getByRole('switch').first()
  121 |   if ((await restartedEnabled.getAttribute('aria-checked')) !== 'true') await restartedEnabled.click()
  122 |   await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 2 * 60_000 })
  123 | })
  124 | 
  125 | test(...caseDefinition('A-02'), async ({ app, mainWindow: page }) => {
  126 |   await ensureCustomChatProvider(app, page)
  127 |   await openSettingsSection(page, 'Skills')
  128 |   if (
  129 |     !(await page
  130 |       .getByText('cherry-regression-fixture', { exact: true })
  131 |       .isVisible()
  132 |       .catch(() => false))
  133 |   ) {
  134 |     await page.getByRole('button', { name: 'Add Skill', exact: true }).click()
  135 |     await page.getByText('Local import', { exact: true }).click()
  136 |     await page.getByRole('button', { name: 'Install from directory', exact: true }).click()
  137 |     await page.waitForTimeout(1_000)
  138 |     chooseNativeFile(app.record.platform, app.paths, join(app.paths.fixtures, 'cherry-regression-fixture'))
  139 |     await expect(page.getByText('cherry-regression-fixture', { exact: true })).toBeVisible({ timeout: 60_000 })
  140 |   }
  141 | 
  142 |   page = await app.restart('authenticated')
  143 |   await dismissOnboarding(page)
  144 |   await openSettingsSection(page, 'API Gateway')
  145 |   const startGateway = page.getByRole('button', { name: 'Start', exact: true })
  146 |   const stopGateway = page.getByRole('button', { name: 'Stop', exact: true })
  147 |   await expect(startGateway.or(stopGateway)).toBeVisible()
  148 |   if (await startGateway.isVisible()) await startGateway.click()
  149 |   await expect(stopGateway).toBeVisible({ timeout: 30_000 })
  150 |   await closeSettings(page)
  151 |   await startNewAgentTask(page, 'Cherry Assistant')
  152 |   const agentView = page.locator('[data-ui~="agent.view"]:visible')
  153 |   await agentView
  154 |     .getByRole('button', { name: 'Select Model', exact: true })
```