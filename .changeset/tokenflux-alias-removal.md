---
'@cherrystudio/ai-core': patch
---

Drop the stale `'tokenflux'` alias from `OpenRouterExtension` in
`packages/aiCore/src/core/providers/core/initialization.ts`. The alias was a
temporary `// TODO: 实现注册后修改拓展配置` placeholder while TokenFlux did
not yet have its own provider extension; `TokenFluxExtension` is now
registered separately (in this repo's renderer-side `extensions/index.ts`),
so the alias would otherwise collide with the real `'tokenflux'` provider id.

`createOpenRouter` is no longer reachable via the `'tokenflux'` provider id;
chat resolution for TokenFlux now goes through the dedicated extension. If
a downstream consumer was relying on the OpenRouter SDK's features
(transforms / plugins / fallback_models / OpenRouter-style web-search) when
addressing TokenFlux, route it explicitly through `name: 'openrouter'`
instead.
