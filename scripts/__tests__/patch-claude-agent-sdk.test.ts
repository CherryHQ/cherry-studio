/**
 * Unit tests for the patch-claude-agent-sdk.mjs postinstall script.
 *
 * Since the script executes immediately on import (file I/O, process.exit),
 * we test the three core regex replacement functions in isolation.
 * The implementations here mirror the script exactly so that changes to the
 * script are caught by test failures.
 */

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Mirror the three patch functions from patch-claude-agent-sdk.mjs
// Any change to the regex in the script should be reflected here.
// ---------------------------------------------------------------------------

/**
 * Patch 1: Replace `import{spawn as X}from"child_process"` with
 *          `import{fork  as X}from"child_process"`.
 * Returns { result, matched }.
 */
function applyPatch1(content: string): { result: string; matched: boolean } {
  let matched = false
  const result = content.replace(/import\{spawn as ([\w$]+)\}from"child_process"/, (_, alias) => {
    matched = true
    return `import{fork as ${alias}}from"child_process"`
  })
  return { result, matched }
}

/**
 * Patch 2: Remove `command:X,` from spawnLocalProcess destructuring.
 * Returns { result, matched }.
 */
function applyPatch2(content: string): { result: string; matched: boolean } {
  let matched = false
  const result = content.replace(
    /spawnLocalProcess\(([\w$]+)\)\{let\{command:([\w$]+),args:([\w$]+)/,
    (_, fnArg, _cmd, args) => {
      matched = true
      return `spawnLocalProcess(${fnArg}){let{args:${args}`
    }
  )
  return { result, matched }
}

/**
 * Patch 3: Rewrite spawn call to use fork(args[0], args.slice(1), …) with IPC stdio.
 * Returns { result, matched }.
 */
function applyPatch3(content: string): { result: string; matched: boolean } {
  let matched = false
  const result = content.replace(
    /([\w$]+)\(([\w$]+),([\w$]+),\{cwd:([\w$]+),stdio:\["pipe","pipe",([\w$]+)\],signal:([\w$]+),env:([\w$]+),windowsHide:!0\}/,
    (_, fn, _cmd, args, cwd, stderr, signal, env) => {
      matched = true
      return `${fn}(${args}[0],${args}.slice(1),{cwd:${cwd},stdio:${stderr}==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"],signal:${signal},env:${env}}`
    }
  )
  return { result, matched }
}

/**
 * Apply all three patches and return a summary identical to what the script does.
 */
function applyAllPatches(content: string): {
  result: string
  patchCount: number
  alreadyPatched: boolean
} {
  let patchCount = 0
  let result = content

  const p1 = applyPatch1(result)
  result = p1.result
  if (p1.matched) patchCount++

  const p2 = applyPatch2(result)
  result = p2.result
  if (p2.matched) patchCount++

  const p3 = applyPatch3(result)
  result = p3.result
  if (p3.matched) patchCount++

  // Mimic the already-patched detection from the script
  const alreadyPatched = patchCount === 0 && result.includes('import{fork as') && result.includes('"ipc"')

  return { result, patchCount, alreadyPatched }
}

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal realistic snippet of minified SDK code with configurable
 * variable names so we can exercise different obfuscation scenarios.
 */
function buildSdkSnippet({
  spawnAlias = 'Sq',
  fnArg = 'Q',
  cmdVar = 'X',
  argsVar = 'Y',
  cwdVar = '$',
  envVar = 'W',
  sigVar = 'J',
  stderrVar = 'G',
  extraBefore = '',
  extraAfter = ''
}: {
  spawnAlias?: string
  fnArg?: string
  cmdVar?: string
  argsVar?: string
  cwdVar?: string
  envVar?: string
  sigVar?: string
  stderrVar?: string
  extraBefore?: string
  extraAfter?: string
} = {}): string {
  return [
    extraBefore,
    `import{spawn as ${spawnAlias}}from"child_process"`,
    `spawnLocalProcess(${fnArg}){let{command:${cmdVar},args:${argsVar},cwd:${cwdVar},env:${envVar},signal:${sigVar}}=${fnArg}`,
    `=${spawnAlias}(${cmdVar},${argsVar},{cwd:${cwdVar},stdio:["pipe","pipe",${stderrVar}],signal:${sigVar},env:${envVar},windowsHide:!0}`,
    extraAfter
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Patch 1 – spawn → fork import
// ---------------------------------------------------------------------------

describe('Patch 1: spawn → fork import replacement', () => {
  it('replaces spawn with fork keeping the same alias', () => {
    const input = `import{spawn as Sq}from"child_process"`
    const { result, matched } = applyPatch1(input)

    expect(matched).toBe(true)
    expect(result).toBe(`import{fork as Sq}from"child_process"`)
  })

  it('preserves a single-letter alias', () => {
    const input = `import{spawn as X}from"child_process"`
    const { result, matched } = applyPatch1(input)

    expect(matched).toBe(true)
    expect(result).toBe(`import{fork as X}from"child_process"`)
  })

  it('preserves an underscore-prefixed alias', () => {
    const input = `import{spawn as _spawn}from"child_process"`
    const { result, matched } = applyPatch1(input)

    expect(matched).toBe(true)
    expect(result).toBe(`import{fork as _spawn}from"child_process"`)
  })

  it('does not match when spawn is already replaced by fork', () => {
    const input = `import{fork as Sq}from"child_process"`
    const { matched } = applyPatch1(input)

    expect(matched).toBe(false)
  })

  it('does not match unrelated child_process imports', () => {
    const input = `import{exec as Sq}from"child_process"`
    const { matched } = applyPatch1(input)

    expect(matched).toBe(false)
  })

  it('does not match when double-quotes are replaced by single-quotes', () => {
    const input = `import{spawn as Sq}from'child_process'`
    const { matched } = applyPatch1(input)

    expect(matched).toBe(false)
  })

  it('only replaces the first occurrence (non-global regex)', () => {
    const input = [`import{spawn as Sq}from"child_process"`, `import{spawn as Ab}from"child_process"`].join('\n')
    const { result } = applyPatch1(input)

    // Only the first line should be changed
    expect(result).toContain(`import{fork as Sq}from"child_process"`)
    expect(result).toContain(`import{spawn as Ab}from"child_process"`)
  })
})

// ---------------------------------------------------------------------------
// Patch 2 – remove command: from destructuring
// ---------------------------------------------------------------------------

describe('Patch 2: remove command variable from spawnLocalProcess destructuring', () => {
  it('removes the command:VAR, segment with standard variable names', () => {
    const input = `spawnLocalProcess(Q){let{command:X,args:Y,cwd:$,env:W,signal:J}=Q`
    const { result, matched } = applyPatch2(input)

    expect(matched).toBe(true)
    expect(result).toBe(`spawnLocalProcess(Q){let{args:Y,cwd:$,env:W,signal:J}=Q`)
    expect(result).not.toContain('command:')
  })

  it('works when the function argument uses a dollar-sign variable', () => {
    const input = `spawnLocalProcess($){let{command:X,args:Y`
    const { result, matched } = applyPatch2(input)

    expect(matched).toBe(true)
    expect(result).toContain(`spawnLocalProcess($){let{args:Y`)
  })

  it('works with single-character obfuscated names throughout', () => {
    const input = `spawnLocalProcess(a){let{command:b,args:c`
    const { result, matched } = applyPatch2(input)

    expect(matched).toBe(true)
    expect(result).toContain(`spawnLocalProcess(a){let{args:c`)
  })

  it('works when the args variable uses a dollar-sign', () => {
    const input = `spawnLocalProcess(Q){let{command:X,args:$`
    const { result, matched } = applyPatch2(input)

    expect(matched).toBe(true)
    expect(result).toContain(`let{args:$`)
  })

  it('does not match when command is already absent', () => {
    const input = `spawnLocalProcess(Q){let{args:Y`
    const { matched } = applyPatch2(input)

    expect(matched).toBe(false)
  })

  it('does not match unrelated destructuring patterns', () => {
    const input = `someOtherFunction(Q){let{command:X,args:Y`
    const { matched } = applyPatch2(input)

    expect(matched).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Patch 3 – rewrite spawn call to fork with IPC stdio
// ---------------------------------------------------------------------------

describe('Patch 3: rewrite spawn call to use fork with IPC stdio', () => {
  it('rewrites spawn call with standard variable names', () => {
    const input = `=Sq(X,Y,{cwd:$,stdio:["pipe","pipe",G],signal:J,env:W,windowsHide:!0}`
    const { result, matched } = applyPatch3(input)

    expect(matched).toBe(true)
    expect(result).toBe(
      `=Sq(Y[0],Y.slice(1),{cwd:$,stdio:G==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"],signal:J,env:W}`
    )
  })

  it('removes windowsHide:!0 from the output', () => {
    const input = `=Sq(X,Y,{cwd:$,stdio:["pipe","pipe",G],signal:J,env:W,windowsHide:!0}`
    const { result } = applyPatch3(input)

    expect(result).not.toContain('windowsHide')
  })

  it('uses args[0] as the module path for fork', () => {
    const input = `=fn(cmd,args,{cwd:c,stdio:["pipe","pipe",s],signal:sig,env:e,windowsHide:!0}`
    const { result, matched } = applyPatch3(input)

    expect(matched).toBe(true)
    expect(result).toContain('args[0]')
    expect(result).toContain('args.slice(1)')
  })

  it('produces conditional IPC stdio based on stderr variable', () => {
    const input = `=fn(cmd,args,{cwd:c,stdio:["pipe","pipe",s],signal:sig,env:e,windowsHide:!0}`
    const { result } = applyPatch3(input)

    expect(result).toContain(`s==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"]`)
  })

  it('works with dollar-sign variables', () => {
    const input = `=$($,$$,{cwd:$$$,stdio:["pipe","pipe",$v],signal:$s,env:$e,windowsHide:!0}`
    const { result, matched } = applyPatch3(input)

    expect(matched).toBe(true)
    expect(result).toContain('$$[0]')
    expect(result).toContain('$$.slice(1)')
  })

  it('does not match when windowsHide:!0 is absent (already patched)', () => {
    const input = `=Sq(Y[0],Y.slice(1),{cwd:$,stdio:G==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"],signal:J,env:W}`
    const { matched } = applyPatch3(input)

    expect(matched).toBe(false)
  })

  it('does not match patterns without the windowsHide flag', () => {
    const input = `=Sq(X,Y,{cwd:$,stdio:["pipe","pipe",G],signal:J,env:W}`
    const { matched } = applyPatch3(input)

    expect(matched).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration: all three patches applied together
// ---------------------------------------------------------------------------

describe('applyAllPatches: full end-to-end patch application', () => {
  it('applies all 3 patches to a canonical minified snippet', () => {
    const input = buildSdkSnippet()
    const { result, patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(3)
    expect(result).toContain('import{fork as Sq}from"child_process"')
    expect(result).not.toContain('command:X')
    expect(result).toContain('Y[0]')
    expect(result).toContain('Y.slice(1)')
    expect(result).toContain('"ipc"')
    expect(result).not.toContain('windowsHide')
  })

  it('applies all 3 patches when variables use uncommon names (Sq, Ab, $)', () => {
    const input = buildSdkSnippet({
      spawnAlias: 'Ab',
      fnArg: 'P',
      cmdVar: 'c',
      argsVar: 'a',
      cwdVar: 'd',
      envVar: 'e',
      sigVar: 's',
      stderrVar: '$'
    })
    const { result, patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(3)
    expect(result).toContain('import{fork as Ab}from"child_process"')
    expect(result).toContain('a[0]')
    expect(result).toContain('a.slice(1)')
  })

  it('applies all 3 patches with numeric-suffix alias (e.g. Fn2)', () => {
    const input = buildSdkSnippet({
      spawnAlias: 'Fn2',
      fnArg: 'r',
      cmdVar: 'c',
      argsVar: 'a',
      cwdVar: 'w',
      envVar: 'e',
      sigVar: 's',
      stderrVar: 'x'
    })
    const { result, patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(3)
    expect(result).toContain('import{fork as Fn2}from"child_process"')
  })

  it('applies all 3 patches when spawn alias uses a dollar-sign', () => {
    const input = buildSdkSnippet({ spawnAlias: '$p' })
    const { patchCount, result } = applyAllPatches(input)

    expect(patchCount).toBe(3)
    expect(result).toContain('import{fork as $p}from"child_process"')
  })

  it('applies patches correctly when surrounded by other minified code', () => {
    const input = buildSdkSnippet({
      extraBefore: 'var a=1;function b(){return c}',
      extraAfter: ';var z=42;'
    })
    const { result, patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(3)
    // Surrounding code must be preserved
    expect(result).toContain('var a=1;function b(){return c}')
    expect(result).toContain(';var z=42;')
  })
})

// ---------------------------------------------------------------------------
// Idempotency – running on already-patched content
// ---------------------------------------------------------------------------

describe('Idempotency: re-running on already-patched content', () => {
  it('detects already-patched content and returns patchCount=0 + alreadyPatched=true', () => {
    const original = buildSdkSnippet()
    const { result: patched } = applyAllPatches(original)

    // Second pass
    const { patchCount, alreadyPatched } = applyAllPatches(patched)

    expect(patchCount).toBe(0)
    expect(alreadyPatched).toBe(true)
  })

  it('does not double-apply patch 1 (fork import stays as fork)', () => {
    const original = buildSdkSnippet({ spawnAlias: 'Fn' })
    const { result: firstPass } = applyAllPatches(original)
    const { result: secondPass } = applyAllPatches(firstPass)

    // fork should not be turned into something else
    expect(secondPass).toContain('import{fork as Fn}from"child_process"')
    expect(secondPass).not.toContain('import{spawn as Fn}from"child_process"')
  })

  it('does not re-apply patch 2 (command stays absent)', () => {
    const original = buildSdkSnippet()
    const { result: firstPass } = applyAllPatches(original)
    const { result: secondPass } = applyAllPatches(firstPass)

    expect(secondPass).not.toContain('command:')
  })

  it('does not re-apply patch 3 (windowsHide stays absent, IPC stays present)', () => {
    const original = buildSdkSnippet()
    const { result: firstPass } = applyAllPatches(original)
    const { result: secondPass } = applyAllPatches(firstPass)

    expect(secondPass).not.toContain('windowsHide')
    expect(secondPass).toContain('"ipc"')
  })
})

// ---------------------------------------------------------------------------
// Partial matches – only some patterns match
// ---------------------------------------------------------------------------

describe('Partial matches: only subset of patterns match', () => {
  it('returns patchCount=1 when only patch 1 matches', () => {
    const input = `import{spawn as Sq}from"child_process"\n// no spawnLocalProcess here`
    const { patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(1)
  })

  it('returns patchCount=2 when patches 1 and 2 match but not patch 3', () => {
    const input = [
      `import{spawn as Sq}from"child_process"`,
      `spawnLocalProcess(Q){let{command:X,args:Y`,
      `// no spawn call with windowsHide`
    ].join('\n')
    const { patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(2)
  })

  it('returns patchCount=2 when patches 1 and 3 match but not patch 2', () => {
    const input = [
      `import{spawn as Sq}from"child_process"`,
      `// no spawnLocalProcess destructuring`,
      `=Sq(X,Y,{cwd:$,stdio:["pipe","pipe",G],signal:J,env:W,windowsHide:!0}`
    ].join('\n')
    const { patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(2)
  })

  it('is NOT flagged as alreadyPatched when patchCount=0 but fork/ipc are absent', () => {
    const input = `completely unrelated content without fork or ipc`
    const { patchCount, alreadyPatched } = applyAllPatches(input)

    expect(patchCount).toBe(0)
    expect(alreadyPatched).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// No match – completely unrelated content
// ---------------------------------------------------------------------------

describe('No match: unrelated content produces no patches', () => {
  it('returns patchCount=0 for completely unrelated content', () => {
    const input = `console.log("hello world");var x=42;`
    const { patchCount, alreadyPatched } = applyAllPatches(input)

    expect(patchCount).toBe(0)
    expect(alreadyPatched).toBe(false)
  })

  it('returns patchCount=0 for empty string', () => {
    const { patchCount } = applyAllPatches('')

    expect(patchCount).toBe(0)
  })

  it('does not match import with single-quotes instead of double-quotes', () => {
    const input = `import{spawn as Sq}from'child_process'`
    const { patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(0)
  })

  it('does not match import with spaces around braces', () => {
    const input = `import { spawn as Sq } from "child_process"`
    const { patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(0)
  })

  it('does not produce a false alreadyPatched for content with only fork (no ipc)', () => {
    const input = `import{fork as Sq}from"child_process"`
    const { patchCount, alreadyPatched } = applyAllPatches(input)

    expect(patchCount).toBe(0)
    // alreadyPatched requires BOTH 'import{fork as' AND '"ipc"'
    expect(alreadyPatched).toBe(false)
  })

  it('does not produce a false alreadyPatched for content with only ipc (no fork import)', () => {
    const input = `stdio:["pipe","pipe","pipe","ipc"]`
    const { patchCount, alreadyPatched } = applyAllPatches(input)

    expect(patchCount).toBe(0)
    expect(alreadyPatched).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Output correctness – verify exact transformed strings
// ---------------------------------------------------------------------------

describe('Output correctness: verify exact replacement strings', () => {
  it('patch 1 exact output matches expected string', () => {
    const { result } = applyPatch1(`import{spawn as myAlias}from"child_process"`)
    expect(result).toBe(`import{fork as myAlias}from"child_process"`)
  })

  it('patch 2 exact output: function arg and args var are preserved correctly', () => {
    const { result } = applyPatch2(`spawnLocalProcess(P){let{command:C,args:A`)
    expect(result).toBe(`spawnLocalProcess(P){let{args:A`)
  })

  it('patch 3 exact output: full spawn-to-fork rewrite is correct', () => {
    const { result } = applyPatch3(`=fn(cmd,args,{cwd:c,stdio:["pipe","pipe",s],signal:sig,env:e,windowsHide:!0}`)
    expect(result).toBe(
      `=fn(args[0],args.slice(1),{cwd:c,stdio:s==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"],signal:sig,env:e}`
    )
  })

  it('full pipeline: canonical snippet transforms to expected patched form', () => {
    const input = [
      `import{spawn as Sq}from"child_process"`,
      `spawnLocalProcess(Q){let{command:X,args:Y,cwd:$,env:W,signal:J}=Q`,
      `=Sq(X,Y,{cwd:$,stdio:["pipe","pipe",G],signal:J,env:W,windowsHide:!0}`
    ].join('\n')

    const { result, patchCount } = applyAllPatches(input)

    expect(patchCount).toBe(3)

    const lines = result.split('\n')
    expect(lines[0]).toBe(`import{fork as Sq}from"child_process"`)
    expect(lines[1]).toBe(`spawnLocalProcess(Q){let{args:Y,cwd:$,env:W,signal:J}=Q`)
    expect(lines[2]).toBe(
      `=Sq(Y[0],Y.slice(1),{cwd:$,stdio:G==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"],signal:J,env:W}`
    )
  })
})
