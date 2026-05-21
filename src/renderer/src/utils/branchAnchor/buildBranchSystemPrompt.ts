/**
 * T-006D-2B mode A — system-prompt template for Text Anchor Branch.
 *
 * This text is the **system instruction** appended to the assistant's prompt
 * when the user opens a branch from selected text. It is NOT shown to the
 * user — `messageThunk.ts:855-857` concatenates `topic.prompt` into the
 * `assistant.prompt` system message; the user message body stays the user's
 * raw follow-up.
 *
 * Non-engineers can tune the wording below freely — it is a plain string
 * constant, not i18n (per CLAUDE.md the i18n rule covers user-visible UI
 * strings; system prompts are model-facing, not user-facing).
 *
 * Placeholders:
 *   {mainGoal}      — first user turn from the main topic, truncated. Optional
 *                      section: omitted entirely when no mainGoal is provided
 *                      (e.g. the main topic has no user message yet).
 *   {selectedText}  — the exact passage the user highlighted in the source
 *                      assistant reply.
 *
 * Why mainGoal is included by default: relational follow-ups
 * ("why did you recommend this over X you mentioned earlier?") need the
 * surrounding intent, which the fork does NOT supply via lineage — see
 * preflight §W2.
 */
const BRANCH_PROMPT_TEMPLATE_WITH_MAIN_GOAL = `这是从一段已有对话中"展开的分支讨论"。
用户在主对话的某条助手回复里选中了下面这段内容，针对它进一步追问。
请围绕这段选区作答，避免泛泛展开或重复主对话已经讨论过的背景。

【主对话的总目标 / 用户最初问的问题】
{mainGoal}

【用户在助手回复中选中的内容】
{selectedText}`

const BRANCH_PROMPT_TEMPLATE_WITHOUT_MAIN_GOAL = `这是从一段已有对话中"展开的分支讨论"。
用户在主对话的某条助手回复里选中了下面这段内容，针对它进一步追问。
请围绕这段选区作答，避免泛泛展开。

【用户在助手回复中选中的内容】
{selectedText}`

const MAIN_GOAL_MAX_CHARS = 200

export interface BuildBranchSystemPromptArgs {
  selectedText: string
  /** First user message from the source topic, optional. Will be truncated to 200 chars. */
  mainGoal?: string
}

/**
 * Renders the branch system prompt.
 *
 * Behavior:
 * - Trims and slices `mainGoal` to `MAIN_GOAL_MAX_CHARS`; empty/whitespace-only
 *   `mainGoal` falls through to the "no main goal" variant.
 * - Trims `selectedText`; passes through as-is otherwise (newlines kept).
 * - No i18n: this is model-facing, not user-facing.
 */
export function buildBranchSystemPrompt(args: BuildBranchSystemPromptArgs): string {
  const selectedText = args.selectedText.trim()
  const rawMainGoal = args.mainGoal?.trim() ?? ''
  const mainGoal =
    rawMainGoal.length > MAIN_GOAL_MAX_CHARS ? `${rawMainGoal.slice(0, MAIN_GOAL_MAX_CHARS)}…` : rawMainGoal

  if (mainGoal.length === 0) {
    return BRANCH_PROMPT_TEMPLATE_WITHOUT_MAIN_GOAL.replace('{selectedText}', selectedText)
  }

  return BRANCH_PROMPT_TEMPLATE_WITH_MAIN_GOAL.replace('{mainGoal}', mainGoal).replace('{selectedText}', selectedText)
}
