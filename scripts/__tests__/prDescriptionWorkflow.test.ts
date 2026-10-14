import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/pr-description-check.yml', 'utf8'))
const job = workflow.jobs['check-description']
const validBody =
  '### What this PR does\nBefore this PR:\nOld behavior.\nAfter this PR:\nNew behavior.\n### Why we need it\nReduce redundant setup.\n### Release note\n```release-note\nNONE\n```'

// Execute both real scripts: validation must remain blocking while synchronize reminders survive failure.
describe('PR description validation and reminders', () => {
  it.each(['opened', 'edited', 'ready_for_review', 'synchronize'])('handles %s in one job', async (action) => {
    for (const body of [validBody, '']) {
      const comments: { id: number; body: string; user: { type: string } }[] = []
      let failed = false
      const core = {
        setFailed: () => {
          failed = true
        },
        info: () => {}
      }
      const github = {
        rest: {
          issues: {
            listComments: async () => ({ data: comments }),
            createComment: async ({ body }: { body: string }) => {
              comments.push({ id: comments.length, body, user: { type: 'Bot' } })
            },
            updateComment: async ({ comment_id, body }: { comment_id: number; body: string }) => {
              comments[comment_id].body = body
            },
            deleteComment: async ({ comment_id }: { comment_id: number }) => {
              comments.splice(comment_id, 1)
            }
          },
          pulls: { listCommits: () => {} }
        },
        paginate: async () => [{ sha: '1234567890', commit: { message: 'ci: updated checks' } }]
      }
      const context = {
        payload: { pull_request: { body } },
        repo: { owner: 'CherryHQ', repo: 'cherry-studio' },
        issue: { number: 1 }
      }
      for (const step of job.steps) {
        const run =
          !step.if ||
          new Function('github', 'always', 'cancelled', `return (${step.if})`)(
            { event: { action } },
            () => true,
            () => false
          )
        if (run)
          await new Function('github', 'core', 'context', `return (async () => { ${step.with.script} })()`)(
            github,
            core,
            context
          )
      }
      expect(failed).toBe(!body)
      expect(comments.some((comment) => comment.body.includes('<!-- pr-description-check -->'))).toBe(!body)
      expect(comments.some((comment) => comment.body.includes('<!-- pr-sync-reminder -->'))).toBe(
        action === 'synchronize'
      )
    }
  })

  it('cancels superseded runs for the same PR and never reminds after cancellation', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['check-description'])
    expect(workflow.concurrency.group).toContain('github.event.pull_request.number')
    expect(workflow.concurrency['cancel-in-progress']).toBe(true)
    const reminder = job.steps.find((step: { name: string }) => step.name === 'Remind to review description')
    expect(
      new Function('github', 'always', 'cancelled', `return (${reminder.if})`)(
        { event: { action: 'synchronize' } },
        () => true,
        () => true
      )
    ).toBe(false)
  })
})
