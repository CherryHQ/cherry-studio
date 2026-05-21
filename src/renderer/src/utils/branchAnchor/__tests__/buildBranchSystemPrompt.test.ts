import { describe, expect, it } from 'vitest'

import { buildBranchSystemPrompt } from '../buildBranchSystemPrompt'

describe('buildBranchSystemPrompt', () => {
  it('includes selectedText and mainGoal when both are provided', () => {
    const out = buildBranchSystemPrompt({
      selectedText: 'distillation transfers behaviour from a teacher to a student',
      mainGoal: 'how do I compress my model for mobile deployment?'
    })

    expect(out).toContain('展开的分支讨论')
    expect(out).toContain('how do I compress my model for mobile deployment?')
    expect(out).toContain('distillation transfers behaviour from a teacher to a student')
    expect(out).toContain('【主对话的总目标')
    expect(out).toContain('【用户在助手回复中选中的内容】')
  })

  it('omits the mainGoal section when no mainGoal is given', () => {
    const out = buildBranchSystemPrompt({
      selectedText: 'student model is the smaller compressed model'
    })

    expect(out).not.toContain('【主对话的总目标')
    expect(out).not.toContain('{mainGoal}')
    expect(out).toContain('【用户在助手回复中选中的内容】')
    expect(out).toContain('student model is the smaller compressed model')
  })

  it('omits the mainGoal section when mainGoal is empty/whitespace', () => {
    const out = buildBranchSystemPrompt({
      selectedText: 'selected',
      mainGoal: '   \n\t '
    })

    expect(out).not.toContain('【主对话的总目标')
  })

  it('truncates mainGoal beyond 200 chars and appends a horizontal ellipsis', () => {
    const long = 'a'.repeat(300)
    const out = buildBranchSystemPrompt({
      selectedText: 'sel',
      mainGoal: long
    })

    expect(out).toContain(`${'a'.repeat(200)}…`)
    expect(out).not.toContain('a'.repeat(201))
  })

  it('trims selectedText whitespace but preserves internal newlines', () => {
    const out = buildBranchSystemPrompt({
      selectedText: '  line one\nline two\nline three  '
    })

    expect(out).toContain('line one\nline two\nline three')
    expect(out).not.toMatch(/\s{2,}line one/)
  })

  it('does not leak any template placeholder tokens into the final output', () => {
    const out = buildBranchSystemPrompt({
      selectedText: 'x',
      mainGoal: 'y'
    })

    expect(out).not.toContain('{selectedText}')
    expect(out).not.toContain('{mainGoal}')
  })
})
