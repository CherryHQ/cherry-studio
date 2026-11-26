import { describe, expect, it } from 'vitest'

import { isFeedbackSubmissionCommand, isPermanentDeletionToolName } from '../assistantCommandSafety'

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

describe('isFeedbackSubmissionCommand', () => {
  it.each([
    'lark-cli base +form-submit --share-token token --as user --json fields.json --yes',
    '/usr/local/bin/lark-cli base +form-submit --share-token token',
    '"/Applications/Lark CLI/lark-cli" base +form-submit --share-token token',
    'lark-cli --profile work base +form-submit --share-token token',
    `sh -c "lark-cli base +form-submit --share-token token"`,
    'gh issue create --repo CherryHQ/cherry-studio --title "Bug" --body-file report.md',
    '  gh issue create --repo CherryHQ/cherry-studio',
    '/usr/local/bin/gh issue create --repo CherryHQ/cherry-studio',
    'cd /workspace && "C:\\Program Files\\GitHub CLI\\gh.exe" issue create --title "Bug"',
    'GH issue create --title "Bug"',
    'gh.EXE issue create --title "Bug"',
    '"C:\\Program Files\\GitHub CLI\\GH.EXE" issue create --title "Bug"',
    'gh \\\n  issue create --title "Bug"',
    'gh -R CherryHQ/cherry-studio issue create --title "Bug"',
    'gh --repo=CherryHQ/cherry-studio issue create --title "Bug"',
    'gh issue -R CherryHQ/cherry-studio create --title "Bug"',
    'gh issue new --title "Bug"',
    'env GH_TOKEN=token gh issue create --title "Bug"',
    'GH_TOKEN=token gh issue create --title "Bug"',
    'command gh issue create --title "Bug"',
    'nohup gh issue create --title "Bug"',
    'sudo -u me gh issue create --title "Bug"',
    'echo report.md | xargs gh issue create --body-file',
    `bash -c 'gh issue create --title "Bug"'`,
    'echo "$(gh issue create --title Bug)"',
    'for repo in a b; do gh issue create -R "$repo" --title Bug; done',
    'bash <<EOF\ngh issue create --title Bug\nEOF',
    'gh issue "$ACTION" --title "Bug"',
    'GH=gh; $GH issue create --title "Bug"',
    'lark-cli base --as user +form-submit --share-token token',
    'lark-cli base --format json +form-submit --share-token token',
    'gh issue --repo CherryHQ/cherry-studio --web create',
    'gh api repos/CherryHQ/cherry-studio/issues -f title=Bug -f body=details',
    'gh api --method POST /repos/{owner}/{repo}/issues --input issue.json',
    'gh api -XPOST repos/CherryHQ/cherry-studio/issues/',
    'gh api -H "Accept: application/json" repos/CherryHQ/cherry-studio/issues -F title=@title.txt',
    `gh api graphql -f query='mutation { createIssue(input: {}) { issue { url } } }'`,
    'gh api "$ENDPOINT" -f title=Bug',
    `python3 -c "import os; os.system('gh issue create --title Bug')"`,
    `node -e "require('child_process').execSync('lark-cli base +form-submit --share-token t')"`,
    'python3 <<EOF\nimport subprocess\nsubprocess.run(["gh", "issue", "create"])\nEOF'
  ])('detects %s', async (command) => {
    await expect(isFeedbackSubmissionCommand(command, 'bash')).resolves.toBe(true)
  })

  it.each([
    'gh issue create --title "Bug"',
    'gh -R CherryHQ/cherry-studio issue create --title "Bug"',
    'cd C:\\work; & "C:\\Program Files\\GitHub CLI\\gh.exe" issue create --title "Bug"'
  ])('detects PowerShell %s', async (command) => {
    await expect(isFeedbackSubmissionCommand(command, 'powershell')).resolves.toBe(true)
  })

  it.each([
    'lark-cli auth status --json --verify',
    'lark-cli base +form-detail --share-token token --format json',
    'printf "lark-cli base +form-submit"',
    'gh issue list --repo CherryHQ/cherry-studio',
    'gh issue view 12 --comments',
    'gh search issues "startup crash" --repo CherryHQ/cherry-studio',
    'gh issue list --search "issue create"',
    'printf "gh issue create"',
    'echo gh issue create',
    'laugh issue create',
    'command -v gh',
    'gh issue list --label create',
    'lark-cli base +form-detail --share-token token --as user',
    'gh api repos/CherryHQ/cherry-studio/issues',
    'gh api repos/CherryHQ/cherry-studio/issues --method GET -f state=open',
    'gh api repos/CherryHQ/cherry-studio/issues/12/comments -f body=thanks',
    `gh api graphql -f query='{ viewer { login } }'`,
    'python3 -c "print(1)"'
  ])('allows non-submission command: %s', async (command) => {
    await expect(isFeedbackSubmissionCommand(command, 'bash')).resolves.toBe(false)
  })
})
