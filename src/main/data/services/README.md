# Data Services

Business-logic layer for DataApi: one service per domain, each a **direct-import singleton** (`export const xxxService = new XxxService()`) over `DbService`. Handlers call services; each service owns its table's invariants.

> Read [DataApi in Main — Implementing Services](../../../../docs/references/data/data-api-in-main.md#implementing-services) before adding or changing a service.

## Key questions → docs

| Question | Where |
|---|---|
| Why a singleton and not a lifecycle service? | [Lifecycle Decision Guide](../../../../docs/references/lifecycle/lifecycle-decision-guide.md#do-not-use-lifecycle-if) |
| How do I implement a handler + service? | [DataApi in Main](../../../../docs/references/data/data-api-in-main.md) |
| Service A needs data owned by service B | [Cross-Service Table Access](../../../../docs/references/data/data-api-in-main.md#cross-service-table-access) |
| A and B call each other → import cycle | [Breaking a circular dependency](../../../../docs/references/data/data-api-in-main.md#breaking-a-circular-dependency-dataserviceregistry) + [`dataServiceRegistry.ts`](./dataServiceRegistry.ts) |
| Concurrent writes / `SQLITE_BUSY` | [Write Serialization](../../../../docs/references/data/database-patterns.md#write-serialization-dbservicewithwritetx) |
| Row → Entity mapping, NULL handling | [Row → Entity Mapping](../../../../docs/references/data/data-api-in-main.md#row--entity-mapping) · [`utils/`](./utils/README.md) |
| `order_key` / reorder / FTS helpers | [`utils/`](./utils/README.md) |
| Naming (files, `Tx` suffix, singular/plural) | [Naming Conventions](../../../../docs/references/naming-conventions.md) |
| Testing a service against a real DB | [Database Testing](../../../../docs/references/testing/database-testing.md) |
| Is this data at all? (DataApi boundary) | [DataApi Scope & Boundaries](../../../../docs/references/data/api-design-guidelines.md#dataapi-scope--boundaries) |

## Local conventions (quick)

- **Singleton, not lifecycle** — `export const xxxService = new XxxService()`; no `getInstance()`, no `new` at call sites.
- **Own your table** — writes to a table you don't own go through the owner's method (pass `tx`); cross-service reads may inline a JOIN.
- **Cross-service cycles** — **only** the services in a real cycle join the registry: they self-register *and* resolve the sibling via `getDataService('X')`. Every other service stays a plain singleton; **never** `await import` to break a cycle.
- **Transactions** — concurrent write paths use `application.get('DbService').withWriteTx(...)`, not `db.transaction(...)`.
- **Paths & logging** — `application.getPath(...)` and `loggerService.withContext(...)`; never ad-hoc.
