import { describe, expect, it } from 'vitest'

import { parseCommand } from '../commandParser'

describe('structured shell syntax', () => {
  it('retains executable boundaries, quotes, source locations and redirection effects', async () => {
    const result = await parseCommand("echo 'git reset --hard'; git -C repo status > output.txt", 'bash')
    expect(result.diagnostics).toEqual([])
    expect(result.commands.map(({ words }) => words.map(({ value }) => value))).toEqual([
      ['echo', 'git reset --hard'],
      ['git', '-C', 'repo', 'status']
    ])
    expect(result.commands[0].words[1]).toMatchObject({ quoted: true, range: { start: 5, end: 23 } })
    expect(result.redirections).toMatchObject([{ operator: '>', target: { value: 'output.txt' } }])
  })

  it('separates pipelines and finds substitutions even without an outer executable', async () => {
    const result = await parseCommand('value=$(rm file); curl url | bash; echo ok | cat', 'bash')
    expect(result.commands.map(({ words }) => words[0].value)).toEqual(['rm', 'curl', 'bash', 'echo', 'cat'])
    expect(result.commands[1].pipeline).toBe(result.commands[2].pipeline)
    expect(result.commands[2].pipeline).not.toBe(result.commands[3].pipeline)
  })

  it('keeps assignments and conditional control context on executable nodes', async () => {
    const result = await parseCommand('FLAG=value git status && (echo ok || rm file)', 'bash')
    expect(result.commands[0].assignments?.map(({ raw }) => raw)).toEqual(['FLAG=value'])
    expect(result.commands.find(({ words }) => words[0].value === 'rm')?.controls).toEqual(
      expect.arrayContaining(['&&', '||', 'subshell'])
    )
  })

  it('records heredoc data independently from its consumer', async () => {
    const result = await parseCommand("cat <<'EOF'\nrm -rf build\nEOF", 'bash')
    expect(result.commands.map(({ words }) => words[0].value)).toEqual(['cat'])
    expect(result.heredocs).toMatchObject([{ delimiter: 'EOF', quoted: true, body: 'rm -rf build\n' }])
  })

  it('connects a heredoc pipeline to the interpreter that receives its body', async () => {
    const result = await parseCommand("cat <<'EOF' | bash\nrm -rf build\nEOF", 'bash')
    expect(result.commands.map(({ words }) => words[0].value)).toEqual(['cat', 'bash'])
    expect(result.commands[1].pipeline).toBe(result.heredocs[0].pipeline)
  })

  it('preserves valid commands when later syntax is incomplete', async () => {
    const result = await parseCommand('rm file; git status && (', 'bash')
    expect(result.commands[0].words[0].value).toBe('rm')
    expect(result.diagnostics).toMatchObject([{ reason: 'syntax-error' }])
  })

  it('uses PowerShell syntax for parameters, strings and executable subexpressions', async () => {
    const result = await parseCommand('Write-Output "$(Remove-Item file)"; git -C repo status', 'powershell')
    expect(result.commands.map(({ words }) => words[0].value)).toEqual(['Write-Output', 'Remove-Item', 'git'])
    expect(result.commands[0].words[1].value).toBeUndefined()
    expect(result.commands[2].words.map(({ value }) => value)).toEqual(['git', '-C', 'repo', 'status'])
  })

  it.each(['bash', 'powershell'] as const)('reports dynamic executables and bounded input in %s', async (dialect) => {
    const dynamic = await parseCommand(dialect === 'bash' ? '"$TOOL" status' : '& $TOOL status', dialect)
    expect(dynamic.diagnostics.some(({ reason }) => reason === 'dynamic-executable')).toBe(true)
    const oversized = await parseCommand('x'.repeat(65_537), dialect)
    expect(oversized.diagnostics).toMatchObject([{ reason: 'input-limit' }])
  })
})
