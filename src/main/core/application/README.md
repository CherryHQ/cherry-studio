# Application

Application is the top-level orchestrator that ties together the lifecycle system and the Electron app.

> **Full documentation** has moved to [docs/references/lifecycle/](../../../../docs/references/lifecycle/README.md).
> This file is a quick-reference pointer.

## Import

Main-process code imports the singleton (and its companions) via the `@application` path alias:

```ts
import { application, serviceList, services } from '@application'
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
├── Application.ts      # Application singleton + lazy proxy
├── serviceRegistry.ts  # Central service registry (add services here)
└── index.ts            # Barrel export
```
