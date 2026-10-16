# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-models-and-assistants.test.ts >> [C-03] Preserve a partial chat response after disconnect and restart
- Location: tests/e2e/regression/03-models-and-assistants.test.ts:132:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-ui~="chat.message"][data-message-id="01a144f0-53da-763f-afb4-248cc41561c5"]:visible').getByText('Sunlight enters a raindrop and separates into colors.', { exact: true })
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for locator('[data-ui~="chat.message"][data-message-id="01a144f0-53da-763f-afb4-248cc41561c5"]:visible').getByText('Sunlight enters a raindrop and separates into colors.', { exact: true })

```

```yaml
- button "Work":
  - button "Work"
- button "Chat":
  - button "Chat"
- button "Translation":
  - button "Translation"
- button "Paintings":
  - button "Paintings"
- button "Knowledge Base":
  - button "Knowledge Base"
- status
- button "Help"
- button "Settings"
- button "User":
  - img "User"
- banner:
  - button "Cherry 助手":
    - text: 😀 Cherry 助手
    - button "Close Tab"
  - button "Launchpad"
  - button "Open global search"
- main:
  - button "Add Assistant"
  - button "Display mode"
  - listbox:
    - button "Cherry 助手 More New Chat":
      - button "Cherry 助手"
      - button "More"
      - button "New Chat"
    - button "Stream failure C-03 More New Chat":
      - button "Stream failure C-03"
      - button "More"
      - button "New Chat"
  - status
  - separator "Resize panel"
  - button "Hide Sidebar" [pressed]
  - 'button "Edit Assistant: Cherry 助手"': 😀 Cherry 助手
  - button "Selected models":
    - img
    - text: Qwen | CherryAI
  - button "Browser"
  - button "Branch Management"
  - text: 😀
  - heading "What should we talk about today?" [level=2]
  - region "Messages"
  - region
  - text: Esc Close ▲▼ Select ⌘ + ▲▼ Page Tab/↩︎ Confirm
  - separator "Resize input height"
  - button "Expand"
  - paragraph: Type a message. Type / for tools and actions, @ to reference topics.
  - button "New Chat"
  - button "Web Search" [disabled]
  - button "Input Quick Panel"
  - button "Start dictation"
  - button "Send" [disabled]: 
```

# Test source

```ts
  153 |             defaultChatEndpoint: 'openai-chat-completions',
  154 |             endpointConfigs: { 'openai-chat-completions': { baseUrl } },
  155 |             apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
  156 |           }
  157 |         }),
  158 |       { providerId, baseUrl: server.baseUrl }
  159 |     )
  160 |     expect(provider.status).toBe(201)
  161 |     const enabled = await page.evaluate(
  162 |       (providerId) =>
  163 |         window.api.dataApi.request({
  164 |           id: `${providerId}-enable`,
  165 |           method: 'PATCH',
  166 |           path: `/providers/${providerId}`,
  167 |           body: { isEnabled: true }
  168 |         }),
  169 |       providerId
  170 |     )
  171 |     expect(enabled.status).toBe(200)
  172 |     const models = await page.evaluate(
  173 |       ({ providerId, modelId }) =>
  174 |         window.api.dataApi.request({
  175 |           id: `${providerId}-model`,
  176 |           method: 'POST',
  177 |           path: '/models',
  178 |           body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
  179 |         }),
  180 |       { providerId, modelId: server.modelId }
  181 |     )
  182 |     expect(models.status).toBe(201)
  183 |     const assistant = await page.evaluate(
  184 |       ({ name, modelId }) =>
  185 |         window.api.dataApi.request({
  186 |           id: 'stream-failure-assistant',
  187 |           method: 'POST',
  188 |           path: '/assistants',
  189 |           body: { name, modelId }
  190 |         }),
  191 |       { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
  192 |     )
  193 |     expect(assistant.status).toBe(201)
  194 |     assistantId = AssistantSchema.parse(assistant.data).id
  195 |     await page.reload()
  196 |     await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
  197 |     const assistantRow = page
  198 |       .locator('[data-ui~="chat.view"]:visible')
  199 |       .locator('[data-ui~="chat.group-header"]')
  200 |       .filter({ hasText: assistantName })
  201 |       .first()
  202 |     await assistantRow.hover()
  203 |     await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
  204 |     await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
  205 |     await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(prompt)
  206 |     await page.getByRole('button', { name: 'Send', exact: true }).click()
  207 | 
  208 |     const request = await server.nextRequest()
  209 |     expect(request.body).toMatchObject({
  210 |       model: server.modelId,
  211 |       stream: true,
  212 |       messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
  213 |     })
  214 |     request.sendText('Sunlight enters a raindrop ')
  215 |     request.sendText('and separates into colors.')
  216 |     const response = page
  217 |       .locator('[data-ui~="chat.message"][data-message-id]:visible')
  218 |       .filter({ hasText: partialText })
  219 |       .last()
  220 |     await expect(response.getByText(partialText, { exact: true })).toBeVisible()
  221 |     await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeVisible()
  222 |     const messageId = await response.getAttribute('data-message-id')
  223 |     if (!messageId) throw new Error('Streaming response has no message ID')
  224 | 
  225 |     // Disconnect only after the renderer has consumed the text, without a finish chunk or [DONE].
  226 |     request.disconnect()
  227 |     await expect
  228 |       .poll(async () => {
  229 |         const stored = await page.evaluate(
  230 |           (id) => window.api.dataApi.request({ id: 'stream-failure-read', method: 'GET', path: `/messages/${id}` }),
  231 |           messageId
  232 |         )
  233 |         expect(stored.status).toBe(200)
  234 |         return MessageSchema.parse(stored.data)
  235 |       })
  236 |       .toMatchObject({
  237 |         id: messageId,
  238 |         status: 'error',
  239 |         data: {
  240 |           parts: expect.arrayContaining([
  241 |             expect.objectContaining({ type: 'text', text: partialText, state: 'done' }),
  242 |             expect.objectContaining({ type: 'data-error' })
  243 |           ])
  244 |         }
  245 |       })
  246 |     await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
  247 |     await expect(response.getByText(partialText, { exact: true })).toBeVisible()
  248 | 
  249 |     page = await app.restart('authenticated')
  250 |     await dismissOnboarding(page)
  251 |     await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
  252 |     const restored = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]:visible`)
> 253 |     await expect(restored.getByText(partialText, { exact: true })).toBeVisible()
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
  254 |     const stored = await page.evaluate(
  255 |       (id) => window.api.dataApi.request({ id: 'stream-failure-reloaded', method: 'GET', path: `/messages/${id}` }),
  256 |       messageId
  257 |     )
  258 |     expect(stored.status).toBe(200)
  259 |     expect(MessageSchema.parse(stored.data)).toMatchObject({
  260 |       id: messageId,
  261 |       status: 'error',
  262 |       data: {
  263 |         parts: expect.arrayContaining([
  264 |           expect.objectContaining({ type: 'text', text: partialText, state: 'done' }),
  265 |           expect.objectContaining({ type: 'data-error' })
  266 |         ])
  267 |       }
  268 |     })
  269 | 
  270 |     await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill('What happens next?')
  271 |     await page.getByRole('button', { name: 'Send', exact: true }).click()
  272 |     const recoveryRequest = await server.nextRequest()
  273 |     recoveryRequest.complete('The light leaves the raindrop.')
  274 |     const recovery = page.locator('[data-ui~="chat.message"][data-message-id]:visible').last()
  275 |     await expect(recovery.getByText('The light leaves the raindrop.', { exact: true })).toBeVisible()
  276 |     const recoveryId = await recovery.getAttribute('data-message-id')
  277 |     if (!recoveryId) throw new Error('Recovery response has no message ID')
  278 |     await expect
  279 |       .poll(async () => {
  280 |         const saved = await page.evaluate(
  281 |           (id) => window.api.dataApi.request({ id: 'stream-recovery-read', method: 'GET', path: `/messages/${id}` }),
  282 |           recoveryId
  283 |         )
  284 |         return MessageSchema.parse(saved.data).status
  285 |       })
  286 |       .toBe('success')
  287 |     await testInfo.attach('Restart persistence and recovery', {
  288 |       body: await page.screenshot(),
  289 |       contentType: 'image/png'
  290 |     })
  291 |   } finally {
  292 |     await server.close()
  293 |     page = await app.mainWindow()
  294 |     await page.evaluate(
  295 |       async ({ assistantId, providerId, namingEnabled }) => {
  296 |         await window.api.preference.set('topic.naming.enabled', namingEnabled)
  297 |         if (assistantId) {
  298 |           await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
  299 |           await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
  300 |         }
  301 |         await window.api.dataApi.request({
  302 |           id: `${providerId}-delete`,
  303 |           method: 'DELETE',
  304 |           path: `/providers/${providerId}`
  305 |         })
  306 |       },
  307 |       { assistantId, providerId, namingEnabled }
  308 |     )
  309 |   }
  310 | })
  311 | 
```