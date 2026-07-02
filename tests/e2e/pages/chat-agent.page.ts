import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { t } from '../utils/i18n'
import { BasePage } from './base.page'

/** Golden's configured chat-capable model for freshly-created assistants (see `createAssistant`). */
export const E2E_ASSISTANT_MODEL_ID = 'deepseek/deepseek-v4-flash'
/** Golden's configured agent-capable model for freshly-created agents (see `createAgent`). */
export const E2E_AGENT_MODEL_ID = 'agent/deepseek-v4-flash'

/**
 * Page Object for the agentic chat flow (assistants / agents pages): create a fresh
 * assistant/agent resource, bring it into the sidebar, type a prompt, send, and observe the
 * tool-call envelope.
 *
 * The golden profile ships no pre-baked assistants/agents — each test creates its own via
 * `createAssistant`/`createAgent` (Library resource wizard) + `addAssistantToSidebar`/
 * `addAgentToSidebar` (the chat sidebar's "添加助手"/"添加智能体" picker). Safe to call every run:
 * the seeded fixture copies a fresh profile per test, so there's no cross-test name collision.
 *
 * These flows are full-tier (live LLM). The deterministic anchor is `message-tool-history`
 * (the process-history collapse group, rendered iff ≥1 tool was actually called). That alone only
 * proves *some* tool fired — to prove *which* one, expand it and check `toolNamed(...)`
 * (`data-tool-name`, the wire tool name). We assert the envelope/tool identity, never the model's
 * text/ranking/quality.
 */
export class ChatAgentPage extends BasePage {
  async gotoAssistants(): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-assistants"]').click()
  }

  async gotoAgents(): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-agents"]').click()
  }

  /**
   * Create a new assistant resource (Library page → "新建助手" wizard): name, model, done —
   * persona step is skipped. `modelId` is the raw, provider-qualified id shown in the model picker
   * (e.g. `deepseek/deepseek-v4-flash`), matched via `[data-testid$="::<modelId>"]` so the lookup
   * doesn't need to know the provider's id. `knowledgeBaseName` links an existing KB on step 3
   * (assistant-only step; agents get a Skills step instead, see `createAgent`).
   */
  async createAssistant(name: string, modelId: string, knowledgeBaseName?: string): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-store"]').click()
    await this.page.getByText(t('library.type.assistant'), { exact: true }).click()
    await this.page.getByRole('button', { name: t('library.config.dialogs.create.assistant_title') }).click()
    await this.fillResourceWizard(name, modelId, knowledgeBaseName)
  }

  /** Same as `createAssistant`, for the agent resource type ("新建智能体") — no knowledge step. */
  async createAgent(name: string, modelId: string): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-store"]').click()
    await this.page.getByText(t('library.type.agent'), { exact: true }).click()
    await this.page.getByRole('button', { name: t('library.config.dialogs.create.agent_title') }).click()
    await this.fillResourceWizard(name, modelId)
  }

  private async fillResourceWizard(name: string, modelId: string, knowledgeBaseName?: string): Promise<void> {
    await this.page.getByLabel(t('common.name')).fill(name)
    await this.page.getByRole('button', { name: t('common.model') }).click()
    await this.page.locator('[data-testid="model-selector-search"]').fill(modelId.split('/').pop() ?? modelId)
    await this.page.locator(`[data-testid$="::${modelId}"]`).first().click()
    const next = this.page.getByRole('button', { name: t('library.config.dialogs.create.next') })
    await next.click()
    await next.click()
    if (knowledgeBaseName) {
      await this.page.getByRole('button', { name: t('library.config.knowledge.add') }).click()
      await this.page.getByPlaceholder(t('library.config.knowledge.search')).fill(knowledgeBaseName)
      await this.page.getByRole('option').filter({ hasText: knowledgeBaseName }).first().click()
    }
    await this.page.getByRole('button', { name: t('library.config.dialogs.create.submit') }).click()
  }

  /**
   * Bring a Library assistant into the chat sidebar and make it the active context (the "添加助手"
   * search dialog — replacement for the old bottom 💬 picker, removed by the chat-layout refactor).
   */
  async addAssistantToSidebar(name: string): Promise<void> {
    await this.gotoAssistants()
    await this.page.getByRole('button', { name: t('chat.add.assistant.title') }).click()
    await this.page.locator('[role="dialog"] input').first().fill(name)
    await this.page.getByRole('option').filter({ hasText: name }).first().click()
  }

  /** Same as `addAssistantToSidebar`, for agents ("添加智能体"). */
  async addAgentToSidebar(name: string): Promise<void> {
    await this.gotoAgents()
    await this.page.getByRole('button', { name: t('agent.add.title') }).click()
    await this.page.locator('[role="dialog"] input').first().fill(name)
    await this.page.getByRole('option').filter({ hasText: name }).first().click()
  }

  /**
   * Enable the assistant's web-search/web-fetch tools ("+" composer tool menu → "网络搜索"). Both
   * `web_search` and `web_fetch` gate on `assistant.settings.enableWebSearch`, which defaults to
   * off for a freshly-created assistant — agents don't need this (separate MCP tool surface, see
   * `addAgentToSidebar`/WS-F2).
   */
  async enableWebSearch(): Promise<void> {
    await this.page.getByRole('button', { name: t('common.add'), exact: true }).click()
    await this.page.getByRole('menuitem', { name: t('chat.input.web_search.label') }).click()
  }

  get composer(): Locator {
    return this.page.locator('[contenteditable="true"]').first()
  }

  get sendButton(): Locator {
    return this.page.getByRole('button', { name: t('chat.input.send') })
  }

  /** Type a prompt into the composer and send it. */
  async ask(prompt: string): Promise<void> {
    await this.composer.click()
    await this.composer.pressSequentially(prompt)
    await this.sendButton.click()
  }

  /** Process-history collapse group — present iff ≥1 tool was called. */
  get toolHistory(): Locator {
    return this.page.locator('[data-testid="message-tool-history"]')
  }

  /** Expand the collapse group — individual tool items only exist in the DOM once expanded. */
  async expandToolHistory(): Promise<void> {
    await this.toolHistory.first().click()
  }

  /**
   * A specific tool call by its wire name (e.g. "web_search", "kb_search" — see `chooseTool`).
   * Requires `expandToolHistory()` first; `message-tool-history` alone only proves *some* tool
   * fired, not which one.
   */
  toolNamed(name: string): Locator {
    return this.page.locator(`[data-tool-name="${name}"]`)
  }

  /**
   * Parsed `data-tool-args` (the call's raw arguments) for every currently-rendered call to
   * `name`. Requires `expandToolHistory()` first, same as `toolNamed`. Needed for tools reached
   * through `tool_invoke` — `kb_search`/`kb_read`/`kb_manage` are unconditionally deferred (see
   * `shouldDefer.ts`), so their own wire name never appears in `data-tool-name`; only
   * `tool_invoke`'s `{ name, params }` arguments reveal which one actually ran. Pair with
   * `expect.poll(...)` for auto-retry, since a call can still be streaming in when checked.
   */
  async toolArgsFor(name: string): Promise<Record<string, unknown>[]> {
    const raw = await this.toolNamed(name).evaluateAll((els) => els.map((el) => el.getAttribute('data-tool-args')))
    return raw.filter((value): value is string => value !== null).map((value) => JSON.parse(value))
  }

  /**
   * Same as `toolArgsFor`, plus each call's `data-tool-status` (`'done'` | `'error'` | ... — see
   * `mapPartStateToStatus` in `toolResponse.ts`). Needed when a call firing isn't enough proof —
   * e.g. a `tool_invoke` that dispatched to the right tool but whose inner execution errored out.
   */
  async toolCallsFor(name: string): Promise<Array<{ args: Record<string, unknown>; status: string | null }>> {
    const raw = await this.toolNamed(name).evaluateAll((els) =>
      els.map((el) => ({ args: el.getAttribute('data-tool-args'), status: el.getAttribute('data-tool-status') }))
    )
    return raw
      .filter((entry): entry is { args: string; status: string | null } => entry.args !== null)
      .map((entry) => ({ args: JSON.parse(entry.args), status: entry.status }))
  }

  /** Web search result block — mounted only when a search finished with results. */
  get webSearchResult(): Locator {
    return this.page.locator('[data-testid="message-websearch-result"]')
  }

  /**
   * Wait for and click "允许" on the composer's tool-permission request
   * (`PermissionRequestComposer`) — appears in place of the normal composer while a
   * `needsApproval` builtin tool (e.g. `kb_manage`) is pending, distinct from an MCP/Claude-agent
   * tool's own approval UI. The long default timeout matches how long the model can take to decide
   * to call the tool in the first place (same latency source as `toolHistory` becoming visible).
   */
  async approveToolPermission(timeout = 180_000): Promise<void> {
    const allow = this.page.getByRole('button', { name: t('agent.toolPermission.button.allow') })
    await expect(allow).toBeVisible({ timeout })
    await allow.click()
  }
}
