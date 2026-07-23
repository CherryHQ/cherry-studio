/**
 * Prompt fragments used by the context module: the truncation marker, the
 * compaction summarizer instruction/scaffolding, and the served-summary
 * wrapper.
 *
 * Vendored from @context-chef/core 3.8.0 (MIT, same author). The output
 * formats here are load-bearing contracts: `getVFSOffloadReminder` must stay
 * in sync with the fs_read system-prompt section (persistedOutput.ts in the
 * main process), and `getCompactSummaryWrapper` is the framing persisted into
 * `message.compaction_summary` rows.
 */
export const ContextPrompts = {
  /**
   * Truncation marker for offloaded tool results. Shows head/tail content
   * with truncation metadata and a retrieval handle.
   *
   * The marker is wrapped in `<persisted-output>...</persisted-output>` so
   * the LLM clearly distinguishes the injected metadata from the surrounding
   * head/tail (which are real content).
   *
   * The metadata line includes a `shown above / shown below` descriptor so
   * the LLM doesn't have to infer from positional context which chunks are
   * the head, tail, or omitted middle. Particularly load-bearing for the
   * tail-only case where the tag appears BEFORE the visible content.
   *
   * When `physicalPath` is provided, the marker advertises the on-disk path
   * as the primary retrieval handle (so the model can read it back with its
   * existing file-read tool) and demotes the URI to an alternative. When
   * `physicalPath` is null (e.g. DB or in-memory adapters), only the URI is
   * shown.
   */
  getVFSOffloadReminder: (
    uri: string,
    totalLines: number,
    totalChars: number,
    headStr: string,
    tailStr: string,
    physicalPath: string | null = null
  ) => {
    const parts: string[] = []

    if (headStr) {
      parts.push(headStr)
    }

    // Use the *actual* slice lengths (post line-snap), not the requested
    // headChars/tailChars — they can differ when snapping rounds inward.
    const showsHead = headStr.length > 0
    const showsTail = tailStr.length > 0
    let descriptor: string
    if (showsHead && showsTail) {
      descriptor = `; first ${headStr.length} chars shown above, last ${tailStr.length} chars shown below`
    } else if (showsHead) {
      descriptor = `; first ${headStr.length} chars shown above, rest omitted`
    } else if (showsTail) {
      descriptor = `; preceding content omitted, last ${tailStr.length} chars shown below`
    } else {
      descriptor = '; preview omitted'
    }

    const handleLines = physicalPath
      ? `Full output saved to: ${physicalPath}\nURI (alternative): ${uri}`
      : `Full output: ${uri}`

    parts.push(
      `\n<persisted-output>\noutput truncated (${totalLines} lines, ${totalChars} chars total${descriptor})\n${handleLines}\n</persisted-output>\n`
    )

    if (tailStr) {
      parts.push(tailStr)
    }

    return parts.join('\n').trim()
  },

  /**
   * Default instruction for compressing rolling history. Structured as a
   * two-phase response: an <analysis> scratchpad (stripped from the final
   * output) followed by a <summary> block. The scratchpad pattern measurably
   * improves summary quality; formatCompactSummary() removes it before the
   * summary reaches the next context window.
   *
   * Domain-agnostic — applicable to coding agents, support agents, research
   * agents, and any other conversational use case.
   */
  CONTEXT_COMPACTION_INSTRUCTION: `
You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary.

Before providing your final summary, wrap your analysis in <analysis></analysis> tags to organize your thoughts and ensure you've covered all necessary points. This analysis scratchpad will be stripped from the final output — use it freely to reason through the conversation.

In your analysis:
- Chronologically review what happened in the conversation
- Identify the user's explicit requests, intents, and any clarifications
- Note key decisions, constraints, and information discovered
- Track errors or obstacles encountered and how they were addressed
- Pay attention to specific user feedback, especially corrections

Your final summary (inside <summary></summary> tags) should be structured, concise, and actionable. Include:

1. Task Overview
   The user's core request and success criteria. Any clarifications or constraints specified.

2. Current State
   What has been completed so far. Key outputs, artifacts, or findings produced. Any state or identifiers that need to persist (file paths, URLs, ticket IDs, etc.) — preserve these verbatim.

3. Important Discoveries
   Constraints or requirements uncovered. Decisions made and their rationale. Approaches that were tried and didn't work (and why). Errors encountered and how they were resolved.

4. Next Steps
   Specific actions needed to complete the task. Any blockers or open questions. Priority order if multiple steps remain.

5. Context to Preserve
   User preferences or style requirements. Domain-specific details that aren't obvious from the conversation. Any promises or commitments made to the user.

Here's an example of the expected format:

<example>
<analysis>
[Your thought process reviewing the conversation, identifying what matters]
</analysis>

<summary>
1. Task Overview:
   [User's core request and success criteria]

2. Current State:
   - [What has been completed]
   - [Key outputs or identifiers to preserve verbatim]

3. Important Discoveries:
   - [Key constraints, decisions, failed approaches, errors resolved]

4. Next Steps:
   - [Specific actions in priority order]

5. Context to Preserve:
   - [Preferences, commitments, domain details]
</summary>
</example>

Be concise but complete — err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.
`.trim(),

  /**
   * Cleans the raw output of a compression model by stripping XML scaffolding.
   *
   * - Removes <analysis>...</analysis> scratchpad blocks
   * - Extracts content from <summary>...</summary> when present
   * - Falls back to the stripped text if no <summary> tag is found
   * - Collapses excessive blank lines and trims whitespace
   *
   * @example
   * formatCompactSummary('<analysis>thinking</analysis><summary>result</summary>')
   * // → 'result'
   */
  formatCompactSummary: (raw: string): string => {
    let out = raw

    // Strip <analysis> scratchpad blocks (case-insensitive, all occurrences)
    out = out.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')

    // Extract <summary> content if present
    const match = out.match(/<summary>([\s\S]*?)<\/summary>/i)
    if (match) {
      out = match[1]
    }

    // Collapse 3+ consecutive newlines into 2, then trim
    return out.replace(/\n{3,}/g, '\n\n').trim()
  },

  /**
   * Wraps a compression summary with context explanation.
   * Tells the model this is a continuation from a compacted conversation,
   * not a fresh start.
   */
  getCompactSummaryWrapper: (summary: string) =>
    `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${summary}

Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`.trim(),

  /**
   * Used when budget compression fires without a compression model
   * (mechanical drop path).
   */
  getFallbackCompressionSummary: (truncatedCount: number) =>
    `
<history_summary>
<ephemeral_message type="history_truncated">
[System: ${truncatedCount} older messages were truncated and compressed to respect context limits.]
</ephemeral_message>
</history_summary>
`.trim()
}
