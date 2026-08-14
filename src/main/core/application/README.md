# Application

Application is the top-level orchestrator that ties together the lifecycle system and the Electron app.

> **Full documentation** has moved to [docs/references/lifecycle/](../../../../docs/references/lifecycle/README.md).
> This file is a quick-reference pointer.

## Import

Main-process code imports the singleton via the `@application` path alias, which resolves **directly to `Application.ts`** (not a directory barrel) — so importing the locator never drags in the whole service registry:

```ts
import { application } from '@application'
```

The service registry (`serviceList` / `services`) is bootstrap-internal; import it directly from its file when wiring startup:

```ts
import { serviceList } from '@main/core/application/serviceRegistry'
```

The alias is configured in `tsconfig.node.json` (`compilerOptions.paths`) and `electron.vite.config.ts` (`main.resolve.alias`). Vitest inherits the Vite alias automatically.

## Quick Links

| Topic | Reference Doc |
|-------|--------------|
| Application architecture & bootstrap flow | [Application Overview](../../../../docs/references/lifecycle/application-overview.md) |
| Lifecycle internals (phases, hooks, states) | [Lifecycle Overview](../../../../docs/references/lifecycle/lifecycle-overview.md) |
| Full usage guide | [Usage Guide](../../../../docs/references/lifecycle/lifecycle-usage.md) |
| Migrating old services | [Migration Guide](../../../../docs/references/lifecycle/lifecycle-migration-guide.md) |

## File Structure

```
application/
├── Application.ts      # Application singleton + lazy proxy — the `@application` alias target
└── serviceRegistry.ts  # Central service registry (add services here); imported directly, not via a barrel
```

No `index.ts` barrel: the two files are independent (the locator vs the bootstrap manifest), so each is imported directly by its consumers rather than bundled behind a door (per [Naming §6.4](../../../../docs/references/naming-conventions.md)).
