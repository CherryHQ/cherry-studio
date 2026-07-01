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
