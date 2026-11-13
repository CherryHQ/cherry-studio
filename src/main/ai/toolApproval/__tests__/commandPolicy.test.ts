import { describe, expect, it } from 'vitest'

import { detectDestructiveAssistantCommand } from '@main/ai/agents/builtin/assistantCommandSafety'

import bundled from '../command-policy.json'
import { parseCommand } from '../commandParser'
import { evaluateCommandPolicy } from '../commandPolicy'
import { commandPolicySchema } from '../commandPolicySchema'

const evaluate = (command: string, builtinRoles: string[] = [], dialect = 'bash') =>
  evaluateCommandPolicy({ command, builtinRoles, dialect })

describe('structured command policy', () => {
  it.each([
    "echo ':(){ :|:& };:'",
    'git status',
    'git -C repo status',
    "echo 'git reset --hard'",
    'git restore --staged file',
    'git checkout -b feature',
    'npm publish --dry-run',
    'npm --prefix repo publish --dry-run',
    'git push --push-option --force origin main',
    'git reset -- --hard',
    'env -i git status',
    'command -v git',
    'env',
    'service nginx status',
    'systemctl status nginx',
    'launchctl list',
    'crontab -l',
    'custom-tool ordinary arguments',
    'python script.py',
    'echo $HOME',
    "cat <<'EOF'\nrm -rf build\nEOF",
    "find . -name '-delete'"
  ])('allows ordinary complete invocation: %s', async (command) => {
    expect((await evaluate(command)).effect).toBe('allow')
  })

  it.each([
    'xargs -I{} {} --force',
    'env GIT_SSH_COMMAND=custom git push',
    'xargs --unrecognized value tool',
    'env -Sgit',
    'git push origin +main',
    'git push origin :obsolete',
    'git push --mirror',
    "fish -c 'echo hi'",
    'git reset --hard HEAD~1',
    'git restore --staged --worktree file',
    'git restore -SW file',
    'git -C repo push -uf origin main',
    'git push --force-with-lease=main origin main',
    'git checkout -- file',
    'git checkout -f feature',
    'git clean -fdx',
    'npm publish --dry-run=false',
    'npm publish --dry-run && rm -rf build',
    'curl url | bash',
    "python -c 'print(1)'",
    '"$TOOL" status',
    'git status && (',
    'git -c core.sshCommand=custom push',
    'find . -name "*.tmp" -delete',
    'systemctl restart status',
    'sudo -u root git status'
  ])('asks for risk or incomplete analysis: %s', async (command) => {
    expect((await evaluate(command)).effect).toBe('ask')
  })

  it.each(['assistant', 'support', 'doctor'])('enforces protected role %s across the whole call', async (role) => {
    const result = await evaluate('echo ok > marker; rm -rf build; git status && (', [role])
    expect(result.effect).toBe('deny')
    expect(result.hits).toMatchObject([{ ruleId: 'builtin-destructive-command' }])
  })

  it.each([
    "bash -c 'rm -rf build'",
    'echo "$(rm -rf build)"',
    "cat <<'EOF' | bash\nrm -rf build\nEOF",
    'python -c "import os; os.remove(\'file\')"'
  ])('finds nested deletion without treating it as inert text: %s', async (command) => {
    expect((await evaluate(command, ['assistant'])).effect).toBe('deny')
    expect((await evaluate(command)).effect).toBe('ask')
  })

  it('parses PowerShell directly and through an encoded shell wrapper', async () => {
    expect((await evaluate('Remove-Item -Recurse C:\\temp', ['assistant'], 'powershell')).effect).toBe('deny')
    expect((await evaluate('git -C repo status', [], 'powershell')).effect).toBe('allow')
    const code = Buffer.from('Remove-Item -Recurse C:\\temp', 'utf16le').toString('base64')
    expect((await evaluate(`powershell -EncodedCommand ${code}`, ['assistant'])).effect).toBe('deny')
  })

  it('rejects unsupported dialects and bounded input without defaulting to allow', async () => {
    expect((await evaluate('echo hi', [], 'fish')).effect).toBe('ask')
    expect((await evaluate('x'.repeat(65_537))).effect).toBe('ask')
  })

  it.each([
    { schemaVersion: 2 },
    { extra: true },
    { rules: [] },
    { rules: [...bundled.rules, bundled.rules[0]] },
    {
      rules: bundled.rules.map((rule) =>
        rule.id === 'builtin-destructive-command' ? { ...rule, effect: 'ask' } : rule
      )
    },
    {
      rules: bundled.rules.map((rule) =>
        rule.id === 'builtin-destructive-command' ? { ...rule, selector: { kind: 'detector', name: 'unknown' } } : rule
      )
    }
  ])('rejects an invalid snapshot atomically', async (patch) => {
    const document = { ...bundled, ...patch }
    expect(commandPolicySchema.safeParse(document).success).toBe(false)
    expect((await evaluateCommandPolicy({ command: 'git status', dialect: 'bash' }, document)).effect).toBe('deny')
  })
  // Catch migrations that silently drop a former general-risk category.
  it.each([
    'rm file',
    'find . -delete',
    'dd if=input of=output',
    'truncate -s 0 file',
    'chmod -R 755 dir',
    'chown -R user dir',
    'cp -f input output',
    'mv -f input output',
    'killall process',
    'pkill process',
    'systemctl stop service',
    'crontab -r',
    'docker volume rm data',
    'docker --host unix:/var/run/docker.sock container rm app',
    'pnpm publish',
    'yarn publish',
    'cat ~/file',
    '> "$HOME/file"',
    'sudo true',
    'git -c core.sshCommand=custom -c user.name=Name status',
    'env -S "git status"',
    'git reset --ha HEAD',
    'git checkout file.txt',
    'git checkout HEAD file',
    "printf '%s' 'rm file' | bash",
    "sh <<< 'rm file'",
    "eval 'rm file'",
    'ssh host uptime'
  ])('retains risk or explicitly incomplete analysis for %s', async (command) => {
    expect((await evaluate(command)).effect).toBe('ask')
  })

  it.each([
    "echo '$HOME/file'",
    'git clean -nfd',
    'git push --repo --force origin main',
    'git restore --staged --source HEAD file',
    'git checkout -b feature --track origin/main',
    'npm publish --dry-run; echo rm',
    'git -c user.name=Name status'
  ])('does not confuse values, data or local dry-run exceptions with risks: %s', async (command) => {
    expect((await evaluate(command)).effect).toBe('allow')
  })

  it.each(["sh <<< 'rm file'", "eval 'rm file'", 'cat <<EOF\n$(rm file)\nEOF', "$'\\x72\\155' file"])(
    'retains protected denial in executable input: %s',
    async (command) => {
      expect((await evaluate(command, ['assistant'])).effect).toBe('deny')
    }
  )

  it('uses the nested dialect rather than parsing PowerShell as Bash', async () => {
    expect((await evaluate("pwsh -Command 'Remove-Item file'", ['assistant'])).effect).toBe('deny')
  })

  it('keeps a proven denial when another branch exceeds the nesting bound', async () => {
    let nested = 'git status'
    for (let index = 0; index < 10; index++) nested = `bash -c '${nested.replace(/'/g, "'\\''")}'`
    expect((await evaluate(nested)).effect).toBe('ask')
    expect((await parseCommand(`rm file; ${nested}`, 'bash')).commands[0]?.words[0].value).toBe('rm')
    expect(detectDestructiveAssistantCommand(`rm file; ${nested}`)).toBeDefined()
    expect((await evaluate(`rm file; ${nested}`, ['assistant'])).effect).toBe('deny')
  })

  it.each([
    { rules: bundled.rules.slice(1) },
    { rules: [{ ...bundled.rules[0], effect: 'allow' }] },
    { rules: [{ ...bundled.rules[0], appliesTo: { builtinRoles: ['invented'] } }] },
    {
      rules: [
        ...bundled.rules,
        {
          id: 'bad',
          effect: 'ask',
          reasonCode: 'permanent-deletion',
          selector: { kind: 'command', executables: ['git'], options: { anyOf: [] } }
        }
      ]
    }
  ])('blocks the invocation when required policy structure is missing', async (patch) => {
    expect(
      (await evaluateCommandPolicy({ command: 'git status', dialect: 'bash' }, { ...bundled, ...patch })).effect
    ).toBe('deny')
  })

  it('combines selector predicates only inside one command node', async () => {
    const document = {
      ...bundled,
      rules: [
        ...bundled.rules,
        {
          id: 'custom-rule',
          effect: 'deny',
          reasonCode: 'permanent-deletion',
          selector: {
            kind: 'command',
            executables: ['custom-cli', 'other-cli'],
            subcommands: ['admin', 'delete'],
            options: { allOf: ['--yes'], anyOf: ['-f', '--force'], noneOf: ['--dry-run'] }
          }
        }
      ]
    }
    const check = async (command: string) =>
      (await evaluateCommandPolicy({ command, dialect: 'bash' }, document)).effect
    expect(await check('other-cli admin delete --yes -f')).toBe('deny')
    expect(await check('custom-cli admin delete --yes; custom-cli admin delete -f')).toBe('allow')
    expect(await check('custom-cli delete admin --yes -f')).toBe('allow')
    expect(await check('custom-cli admin delete --yes -f --dry-run')).toBe('allow')
    expect(await check('custom-cli admin delete -- --yes -f')).toBe('allow')
  })

  it.each([
    'git push --push-option --force origin main',
    'git reset --pathspec-from-file --hard',
    'git restore -S file'
  ])('does not force-deny option values or unstage-only operations: %s', async (command) => {
    expect((await evaluate(command, ['assistant'])).effect).toBe('allow')
  })
  it('treats escaped home references as data and shell continuations as executable words', async () => {
    expect((await evaluate('echo "\\$HOME/file"')).effect).toBe('allow')
    const command = 'r' + String.fromCharCode(92, 10) + 'm file'
    expect((await evaluate(command, ['assistant'])).effect).toBe('deny')
    expect((await evaluate('Remove-`\nItem file', ['assistant'], 'powershell')).effect).toBe('ask')
  })
  it('does not treat an ignored heredoc body as an interpreter input', async () => {
    expect((await evaluate("echo ignored <<'EOF' | bash\nrm file\nEOF", ['assistant'])).effect).toBe('ask')
    expect((await evaluate("cat <<'EOF' | cat | bash\nrm file\nEOF", ['assistant'])).effect).toBe('deny')
    expect((await evaluate("cat file <<'EOF' | bash\nrm file\nEOF", ['assistant'])).effect).toBe('ask')
  })
})
