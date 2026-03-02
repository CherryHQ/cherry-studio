/**
 * Postinstall script to patch @anthropic-ai/claude-agent-sdk
 *
 * The SDK is shipped as minified/obfuscated code, so we use semantic regex
 * patterns (not variable names) to apply patches. This is more resilient
 * to SDK version bumps than a static .patch file.
 *
 * Changes:
 * 1. spawn → fork (child_process import) — enables IPC channel
 * 2. Remove `command` from spawnLocalProcess destructuring
 * 3. Rewrite spawn call to use fork(args[0], args.slice(1), ...) with IPC stdio
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require_ = createRequire(import.meta.url)

let sdkPath
try {
  sdkPath = path.join(path.dirname(require_.resolve('@anthropic-ai/claude-agent-sdk')), 'sdk.mjs')
} catch {
  console.log('[patch-claude-agent-sdk] Package not installed, skipping.')
  process.exit(0)
}

let content
try {
  content = readFileSync(sdkPath, 'utf-8')
} catch {
  console.error(`[patch-claude-agent-sdk] Failed to read ${sdkPath}`)
  process.exit(1)
}

let patchCount = 0

// 1. Replace `import{spawn as X}from"child_process"` with `import{fork as X}from"child_process"`
content = content.replace(/import\{spawn as ([\w$]+)\}from"child_process"/, (_, alias) => {
  patchCount++
  return `import{fork as ${alias}}from"child_process"`
})

// 2. Remove `command:X,` from spawnLocalProcess destructuring
//    Before: spawnLocalProcess(Q){let{command:X,args:Y,cwd:$,env:W,signal:J}=Q
//    After:  spawnLocalProcess(Q){let{args:Y,cwd:$,env:W,signal:J}=Q
content = content.replace(
  /spawnLocalProcess\(([\w$]+)\)\{let\{command:([\w$]+),args:([\w$]+)/,
  (_, fnArg, _cmd, args) => {
    patchCount++
    return `spawnLocalProcess(${fnArg}){let{args:${args}`
  }
)

// 3. Rewrite the spawn/fork call:
//    Before: =Sq(X,Y,{cwd:$,stdio:["pipe","pipe",G],signal:J,env:W,windowsHide:!0})
//    After:  =Sq(Y[0],Y.slice(1),{cwd:$,stdio:G==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"],signal:J,env:W})
//
//    Pattern captures: spawnFn(cmdVar, argsVar, {cwd:cwdVar, stdio:[...stderrVar...], signal:sigVar, env:envVar, windowsHide:!0})
content = content.replace(
  /([\w$]+)\(([\w$]+),([\w$]+),\{cwd:([\w$]+),stdio:\["pipe","pipe",([\w$]+)\],signal:([\w$]+),env:([\w$]+),windowsHide:!0\}/,
  (_, fn, _cmd, args, cwd, stderr, signal, env) => {
    patchCount++
    return `${fn}(${args}[0],${args}.slice(1),{cwd:${cwd},stdio:${stderr}==="pipe"?["pipe","pipe","pipe","ipc"]:["pipe","pipe","ignore","ipc"],signal:${signal},env:${env}}`
  }
)

if (patchCount === 0) {
  // Check if already patched
  if (content.includes('import{fork as') && content.includes('"ipc"')) {
    console.log('[patch-claude-agent-sdk] Already patched, skipping.')
    process.exit(0)
  }
  console.error('[patch-claude-agent-sdk] No patterns matched! The SDK structure may have changed.')
  process.exit(1)
}

if (patchCount < 3) {
  console.warn(`[patch-claude-agent-sdk] Warning: only ${patchCount}/3 patches applied.`)
}

writeFileSync(sdkPath, content, 'utf-8')
console.log(`[patch-claude-agent-sdk] Successfully applied ${patchCount}/3 patches to sdk.mjs`)
