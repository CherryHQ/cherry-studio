# Agent Note: Web Core Worker 数据库层

Status: proposed

[English](2026-10-20-web-core-database.md) | 中文

## Problem

Issue #21728 要求提供 Web 版。它的目的是免安装试用:用户在浏览器里直接体验 Cherry Studio,不必下载并启动桌面应用。范围是登录、对话、Agent 和简单设置;其他模块只留在桌面端。设计评审选定所有计算都在用户浏览器里完成:界面在主线程,Core Worker 承载数据层服务和 aiCore。issue 里的独立后端指企业后端已有的共享服务(登录、`/v1` 模型网关、`configurations`、备份),不为用户开进程,因为评审认为为每个用户开服务端容器成本太高。该设计假定 v2 数据层(better-sqlite3 加 Drizzle、28 个迁移、带触发器的 FTS5、一个自定义 SQL 函数)可以不改动地在浏览器里运行。如果不行,上层大部分工作要重做。

2026-10-19/20 的一次一次性验证表明可行,同时发现了一个数据安全隐患:使用默认的 `opfs-sahpool` 存储层时,写入中途终止 Worker(刷新页面)会损坏数据库(6 万行事务:Chrome 4/4 损坏,Safari 内核从 400 ms 起损坏;连续小事务:Chrome 约 10%,Safari 2% 到 5%)。非池化的 `opfs` 存储层在所有抽样中都干净回滚(大事务两个浏览器共 10/10;小事务 Chrome 0/32、Safari 内核 0/48),但它要求跨域隔离(`COOP: same-origin`、`COEP: require-corp`),写入也更慢(1 万条消息:Chrome 3.6 s 变 4.8 s,WebKit 1.2 s 变 4.4 s)。验证代码已丢弃,本文把结论落成产品代码。

## Proposal

只交付里程碑 M0 的数据库层;登录、对话、Agent 和设置留给后续 Spec。M0 的其余验证项不在本文范围:把 `AiStreamManager` 精简到能在 Worker 里运行、Safari 下的损坏检测与备份恢复、跨域隔离对第三方资源的影响。

1. **`packages/sqlite-wasm-compat`**:基于 `@sqlite.org/sqlite-wasm` 的 better-sqlite3 兼容壳。Drizzle 的 better-sqlite3 驱动只需要 `prepare().run/get/all/raw` 和 `transaction().deferred/immediate/exclusive`,所以 `src/main/data` 保持不动。兼容壳必须:
   - 打开时设置 `PRAGMA foreign_keys = ON`(sqlite-wasm 默认关闭);
   - 抛出带 SQLite `code` 的错误,例如 `SQLITE_CONSTRAINT_UNIQUE`;
   - 像 better-sqlite3 一样拒绝返回 Promise 的事务回调;
   - 支持用于 `knowledge_item_name` 的 `function()`,以及通过 savepoint 实现的嵌套事务;
   - 支持带 `{ simple: true }` 的 `pragma()`,测试工具和完整性检查会调用它;
   - 接受注入的存储后端:内存(Node 测试)或 OPFS(浏览器)。
2. **`packages/web-core`**:数据库部分的 Core Worker 宿主:
   - 用非池化 `opfs` 存储层打开数据库,最多重试约 3 秒,因为上一个 Worker 的文件句柄释放较晚;
   - 每个账号持有一把 Web Lock,拒绝第二个标签页(非池化存储层不再自行拒绝);
   - 运行现有迁移链的 `applyMigrations`,并通过分批和让出事件循环,使 Worker 里每个任务都在 1 秒内;`drizzle-orm/better-sqlite3/migrator` 用别名换成读取构建时打包的迁移文件的实现,因为原版用 `node:fs` 读目录;
   - 通过打包器别名把 `@application` 和 `@logger` 解析到浏览器实现,不修改 `src/main`;
   - 提供浏览器版 `DbService`,保持相同的 `getDb()` 和 `withWriteTx()`,由它自己打开数据库,不套用桌面端的 WAL 和 `busy_timeout` 设置;
   - 用同样方式只替换范围内服务实际用到的、依赖 Electron 或 Node 的模块。M0 替换 `TopicService`、`MessageService` 和 `ApiServer` 用到的这些:`src/main/core/diagnostics`、`src/main/core/platform.ts`(它在模块加载时就读取 `process`),以及 `node:crypto` 和 `node:util` 的引入。登录、Agent 和设置各自的 Spec 再补上它们的服务需要的替换;只服务于范围外功能的模块(例如 `registryDataPaths`、`appEdition`、`retiredAgentRuntimeMigration`)一律不替换。
3. **真实服务跑在 Worker 里**:`TopicService` 和 `MessageService` 通过 DataApi `ApiServer` 在 Worker 中运行,由测试页面通过 `postMessage` 调用。
4. **实测**:在 Chromium 和 WebKit 里测 5 万条消息(远超试用账号的数据量)的冷迁移、热启动和查询耗时。开发过程中测得的 50 万条数据保留在风险部分作参考。

位置:两个包都放在 `packages/` 下,因此不影响 `src/` 的封闭顶层集合和 Electron 构建。Web 构建入口和 `apps/` 布局推迟到需要它的里程碑。

## Alternatives considered

- **保留 `opfs-sahpool`,靠备份兜底。** Safari 普通刷新页面就会丢数据,备份会变成主要机制而不是最后兜底。仅在产品拒绝跨域隔离时作为退路。
- **服务端 SQLite 加服务端运行服务。** 需要每用户服务端状态,评审已因成本否决。
- **为浏览器分叉服务代码。** 重复业务逻辑;验证表明 Drizzle 驱动这条接缝使其没有必要。
- **代码放在 `src/web`。** 第四个进程根目录需要先修改封闭集合命名规则,对数据库层没有收益。
- **移植全部桌面模块。** 登录、对话、Agent 和简单设置足以展示产品;每多一个模块,就多一份下载体积,也多一批只能在 Electron 里运行的代码要替换。
- **等 Firefox 验证后再开始。** Firefox 放在本 Spec 的最后一条 AC 里检查,不阻塞兼容壳。

## Acceptance criteria

- AC1 — 用 wasm 驱动替换 better-sqlite3 后,整个主进程测试套件全部通过;只有按范围外类别(真实数据库文件与备份恢复、备份 API、旧版 v1 迁移、sqlite-vec 向量库、真实网络探测)列明的测试文件在兼容性运行的配置里被排除。(verification: 单元测试)
- AC2 — 驱动打开时启用外键、保留 SQLite 错误码、拒绝返回 Promise 的事务回调并支持嵌套事务;级联删除会删除从属行。(verification: 单元测试)
- AC3 — 在 Chromium 和 WebKit 中,Core Worker 用非池化存储层打开 OPFS 数据库,应用包含 FTS5 表及触发器在内的全部生产迁移,刷新页面后数据和 `PRAGMA integrity_check` 保持完好。(verification: 打包产物,两个引擎的 Playwright)
- AC4 — 在 6 万行事务的 10 个不同时刻终止 Worker,数据库在两个引擎中都通过 `integrity_check`,且该事务完整回滚。(verification: 打包产物)
- AC5 — 同一账号的第二个标签页被 Web Lock 拒绝,无法写入数据库。(verification: 打包产物)
- AC6 — `TopicService` 和 `MessageService` 原样在 Worker 中运行:通过 DataApi 服务创建话题、追加消息、列出消息都返回正确结果,`MessageService.search` 能通过全文搜索找到消息。(verification: 打包产物)
- AC7 — `src/main` 和 `src/renderer` 下没有文件被修改,Electron 数据层测试仍然通过。(verification: 单元测试及变更范围报告)
- AC8 — 记录两个引擎在 5 万条消息下的冷迁移、热启动和查询耗时,且迁移或启动检查期间没有任何 Worker 任务超过 1 秒。(verification: 打包产物,结果记入 implemented 笔记)
- AC9 — 同一套测试在 Firefox 中运行一次并记录结果;失败不阻塞 AC1 到 AC8,但必须列入风险。(verification: 打包产物)

## Risks

- **浏览器里的 Agent。** 桌面端 Agent 会读写本地文件、执行命令,浏览器两样都做不到。没有服务端沙盒(评审已因成本否决)的话,Web 版 Agent 只能使用联网工具,例如网页搜索和远程 MCP 服务。负责人需要确认这就是预期的 Agent。
- **`opfs` 崩溃样本小。** 0/32 和 0/48 不能证明安全;仍然必须检测损坏,由后续 Spec 决定恢复方式是重置试用数据库还是从备份恢复。
- **跨域隔离。** COOP/COEP 可能破坏第三方 iframe 和没有 CORP 头的子资源;Web 构建上线前负责人必须接受这一点。登录必须用整页跳转,因为 `COOP: same-origin` 会切断弹窗与打开它的页面之间的联系。
- **页面体积。** 试用体验取决于第一次打开够快。仅数据库层就要下载约 600 KB(gzip 后;Worker 203 KB,`sqlite3.wasm` 402 KB);之后每加一个模块都要对照首屏加载预算检查。
- **每个账号只能开一个标签页。** 第二个标签页会被拒绝,而不是共享数据库;试用用户很少同时开两个,界面只需给出明确提示。发布新版本后,新标签页要等仍在旧表结构上的旧标签页关闭才能打开。
- **Chrome 宽限期是推断。** 1 秒任务预算依赖未经验证的约 2 秒强杀宽限。
- **启动耗时随数据增长。** 5 万条消息时热启动检查在预算内(Chromium 107 ms、WebKit 228 ms、Firefox 352 ms),主要耗在 `foreign_key_check`。50 万条时 WebKit(1.8 s)和 Firefox(3.4 s)超过 1 秒:对试用可以接受;但如果 Web 版将来要长期保存数据,就必须改成只在实际执行了迁移时才检查,这需要修改 `src/main`。
- **大批写入卡顿。** 灌入 50 万条消息时,单个 2000 行的写入批次最长耗时 7.4 s(Chromium)、6.6 s(WebKit)和 24 s(Firefox),期间 Worker 的其他请求全部被阻塞;原因尚未查清。试用场景的写入量小得多,但导入功能不能用大事务写入。
- **Firefox 较慢。** 功能测试全部通过,但写入比 Chromium 慢 4 到 6 倍(6 万行事务要 18.5 s)。
- **兼容壳漂移。** 兼容壳只覆盖仓库用到的 better-sqlite3 接口;新增对其他方法(`backup`、`serialize`、`loadExtension`)的使用会失败,直到补上。主进程测试套件的兼容性运行(AC1)是手动脚本,不在 CI 里把关,退化了可能没人发现。
- **打包别名。** 如果 `src/main` 的服务开始引入更多仅 Electron 可用的模块,浏览器构建会失效;`bundle-web-core` 校验任务遇到任何 Node 或 Electron 引入都会失败,修复可能需要新增浏览器实现。
- **搜索路由。** `/search/contents` 同时搜索 Agent 会话,而这些服务还不能在浏览器里运行;在此之前 Web 界面不能原样使用这个路由。
