import { describe, expect, it } from 'vitest'

import {
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from '../assistantCommandSafety'

describe('isPermanentDeletionToolName', () => {
  it.each([
    'mcp__filesystem__delete',
    'mcp__files__delete_file',
    'mcp__files__delete_directory',
    'mcp__files__remove_file',
    'mcp__files__remove_directory'
  ])('detects %s', (toolName) => {
    expect(isPermanentDeletionToolName(toolName)).toBe(true)
  })

  it.each(['Bash', 'mcp__assistant-files__move_to_trash', 'mcp__cherry-tools__kb_manage'])(
    'does not misclassify %s',
    (toolName) => {
      expect(isPermanentDeletionToolName(toolName)).toBe(false)
    }
  )
})

describe('isLarkFormSubmissionCommand', () => {
  it.each([
    'lark-cli base +form-submit --share-token token --as user --json fields.json --yes',
    '/usr/local/bin/lark-cli base +form-submit --share-token token',
    '"/Applications/Lark CLI/lark-cli" base +form-submit --share-token token'
  ])('detects %s', (command) => {
    expect(isLarkFormSubmissionCommand(command)).toBe(true)
  })

  it.each([
    'lark-cli auth status --json --verify',
    'lark-cli base +form-detail --share-token token --format json',
    'printf "lark-cli base +form-submit"'
  ])('allows non-submission command: %s', (command) => {
    expect(isLarkFormSubmissionCommand(command)).toBe(false)
  })
})

describe('isGitHubIssueCreationCommand', () => {
  it.each([
    'gh issue create --repo CherryHQ/cherry-studio --title "Bug" --body-file report.md',
    '  gh issue create --repo CherryHQ/cherry-studio',
    '/usr/local/bin/gh issue create --repo CherryHQ/cherry-studio',
    'cd /workspace && "C:\\Program Files\\GitHub CLI\\gh" issue create --title "Bug"'
  ])('detects %s', (command) => {
    expect(isGitHubIssueCreationCommand(command)).toBe(true)
  })

  it.each([
    'gh issue list --repo CherryHQ/cherry-studio',
    'gh search issues "startup crash" --repo CherryHQ/cherry-studio',
    'printf "gh issue create"',
    'echo gh issue create',
    'laugh issue create'
  ])('allows non-creation command: %s', (command) => {
    expect(isGitHubIssueCreationCommand(command)).toBe(false)
  })
})
