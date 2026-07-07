/**
 * The single runtime entry point to the pi coding-agent SDK.
 *
 * pi is ESM-only and its `package.json#exports` defines only the `import`/`types`
 * conditions (no `require`/`default`). Cherry's electron-vite MAIN bundle is CJS
 * and externalizes `dependencies`, so a static `import`/`require` of pi throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime. A native dynamic `import()` is
 * preserved by the bundler and honors the `import` condition (verified in the
 * Phase 0 bundling spike). Every runtime use of pi values MUST go through here;
 * `import type` elsewhere is compile-only and safe.
 */
export function loadPiSdk() {
  return import('@earendil-works/pi-coding-agent')
}

/**
 * The api-family layer under pi-coding-agent. pi drives providers through these
 * pure `stream`/`streamSimple` functions; a transport-adapter provider wraps the
 * openai-responses family here so it can inject per-call OAuth creds without pi
 * learning any provider specifics. Same ESM-only dynamic-import contract as
 * {@link loadPiSdk} — `@earendil-works/pi-ai` is pinned to pi-coding-agent's own
 * version so this is the identical implementation pi would use by default.
 */
export function loadPiAi() {
  return import('@earendil-works/pi-ai')
}

export function loadPiOpenAiResponsesApi() {
  return import('@earendil-works/pi-ai/api/openai-responses')
}
