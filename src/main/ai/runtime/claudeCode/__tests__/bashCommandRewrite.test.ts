import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { BashCommandRewriter } from '../bashCommandRewrite'

const parserPaths = {
  runtime: path.join(process.cwd(), 'node_modules/web-tree-sitter/web-tree-sitter.wasm'),
  bashGrammar: path.join(process.cwd(), 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm')
}

function createRewriter() {
  return new BashCommandRewriter(() => parserPaths)
}

async function expectRewrite(input: string, output: string) {
  await expect(createRewriter().rewrite(input)).resolves.toEqual({
    kind: 'rewritten',
    command: output,
    count: (input.match(/\b(?:npx|pipx)\b/g) ?? []).length
  })
}

describe('BashCommandRewriter', () => {
  it.each([
    ['npx pkg --flag value', 'bun x pkg --flag value'],
    ['npx @scope/pkg@1.2.3 arg', 'bun x @scope/pkg@1.2.3 arg'],
    ['npx -y pkg arg', 'bun x  pkg arg'],
    ['npx --yes pkg arg', 'bun x  pkg arg'],
    ['npx -p pkg bin arg', 'bun x -p pkg bin arg'],
    ['npx --package pkg bin arg', 'bun x --package pkg bin arg'],
    ['npx --no-install pkg arg', 'bun x --no-install pkg arg'],
    ['CI=1 npx pkg > output.txt', 'CI=1 bun x pkg > output.txt'],
    ['npx one && npx -y two | npx -p three bin', 'bun x one && bun x  two | bun x -p three bin'],
    ['(npx pkg); f() { npx --no-install other; }', '(bun x pkg); f() { bun x --no-install other; }'],
    ['echo "$(npx pkg --name \\"原样\\")"', 'echo "$(bun x pkg --name \\"原样\\")"'],
    ['printf "你好" && npx -y pkg --label "世界"', 'printf "你好" && bun x  pkg --label "世界"']
  ])('rewrites supported command syntax: %s', async (input, output) => {
    await expectRewrite(input, output)
  })

  it.each([
    ['pipx run ruff check .', 'uvx  ruff check .'],
    ['pipx run --spec httpie http --help', 'uvx  --from httpie http --help'],
    ['pipx run --spec ruff==0.3.0 ruff check', 'uvx  --from ruff==0.3.0 ruff check'],
    ['CI=1 pipx run cowsay hello | npx prettier --check .', 'CI=1 uvx  cowsay hello | bun x prettier --check .'],
    ['echo "$(pipx run pycowsay \\"你好\\")"', 'echo "$(uvx  pycowsay \\"你好\\")"']
  ])('rewrites supported pipx run syntax: %s', async (input, output) => {
    await expectRewrite(input, output)
  })

  it.each([
    'echo "npx pkg"',
    "printf '%s' npx",
    '# npx package',
    "cat <<'EOF'\nnpx package\nEOF",
    'value=npx echo "$value"',
    "'npx' package",
    'n\\px package',
    'npx --version',
    'npx -v',
    'npx --help',
    'npx -h',
    'echo "pipx run ruff"',
    'pipx list'
  ])('ignores package-runner text that is not a supported literal command: %s', async (input) => {
    await expect(createRewriter().rewrite(input)).resolves.toEqual({ kind: 'unchanged' })
  })

  it.each([
    'npx',
    'npx -y',
    'npx -p pkg',
    'npx -p "$PACKAGE" bin',
    'npx "$PACKAGE"',
    'npx --call "echo hi"',
    'npx --workspace app pkg',
    'npx --shell bash pkg',
    'npx --unknown pkg',
    'npx https://example.com/tool'
  ])('fails closed for unsupported or dynamic runner syntax: %s', async (input) => {
    const result = await createRewriter().rewrite(input)
    expect(result.kind).toBe('denied')
    if (result.kind === 'denied') expect(result.reason).toContain('bun x')
  })

  it.each([
    'pipx run',
    'pipx run "$PACKAGE"',
    'pipx run --python python3.12 ruff',
    'pipx run ruff==0.3.0',
    'pipx run --spec package',
    'pipx run --spec "$PACKAGE" executable',
    'pipx run --spec package "$EXECUTABLE"',
    'pipx run --spec https://example.com/tool tool'
  ])('fails closed for unsupported or dynamic pipx run syntax: %s', async (input) => {
    const result = await createRewriter().rewrite(input)
    expect(result.kind).toBe('denied')
    if (result.kind === 'denied') expect(result.reason).toContain('uvx')
  })

  it('fails closed for malformed Bash containing a potential package-runner token', async () => {
    await expect(createRewriter().rewrite('if true; then npx pkg')).resolves.toMatchObject({ kind: 'denied' })
  })

  it('fails closed when the WASM parser cannot initialize', async () => {
    const rewriter = new BashCommandRewriter(() => ({
      runtime: '/does/not/exist/web-tree-sitter.wasm',
      bashGrammar: '/does/not/exist/tree-sitter-bash.wasm'
    }))

    await expect(rewriter.rewrite('npx pkg')).resolves.toMatchObject({
      kind: 'denied',
      reason: expect.stringContaining('could not be initialized')
    })
    await expect(rewriter.rewrite('pipx run ruff')).resolves.toMatchObject({
      kind: 'denied',
      reason: expect.stringContaining('could not be initialized')
    })
    await expect(rewriter.rewrite('echo safe')).resolves.toEqual({ kind: 'unchanged' })
  })

  it('initializes its parser only once and skips initialization when package runners are absent', async () => {
    const resolvePaths = vi.fn(() => parserPaths)
    const rewriter = new BashCommandRewriter(resolvePaths)

    await expect(rewriter.rewrite('echo safe')).resolves.toEqual({ kind: 'unchanged' })
    expect(resolvePaths).not.toHaveBeenCalled()

    await rewriter.rewrite('npx first')
    await rewriter.rewrite('pipx run second')
    expect(resolvePaths).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized candidate input but leaves oversized unrelated Bash alone', async () => {
    const padding = 'x'.repeat(256 * 1024)
    await expect(createRewriter().rewrite(`${padding} npx pkg`)).resolves.toMatchObject({ kind: 'denied' })
    await expect(createRewriter().rewrite(`echo ${padding}`)).resolves.toEqual({ kind: 'unchanged' })
  })
})
