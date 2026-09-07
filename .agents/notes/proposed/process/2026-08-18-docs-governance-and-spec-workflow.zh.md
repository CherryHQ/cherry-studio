# Agent Note: Docs governance and spec-driven workflow

Status: proposed

[English](2026-08-18-docs-governance-and-spec-workflow.md) | 中文

## Problem

本仓库的开发者文档有四个相互关联的缺陷,而且没有任何机制能发现它们。

**文档在无声地腐烂。** `docs/guides/middleware.md` 在教已删除的 v1 `AiProviderMiddlewareTypes` 中间件系统(`src/` 中零命中)。`docs/references/messaging/message-system.md` 描述的 Redux + IndexedDB 消息存储早已不存在:仓库没有 `@reduxjs/toolkit` 依赖,没有 `messageThunk.ts`,没有 `src/renderer/store/`。这两篇在贡献者和 agent 眼里都是现行权威。唯一的文档门禁 `docs:check-links` 只校验链接目标存在——仅此而已——而且 CI 根本不跑它:`ci:basic-check` 覆盖 lint、format、typecheck、i18n 和 skills,不含文档。

**层级在误导读者。** `guides/` 与 `references/` 的二分并不成立:`guides/` 里大多是流程规范(contributing、branching-strategy、test-plan)和用法参考(logging、i18n、diagnostics),不是教程。`references/` 顶层是开放集,17 个域目录与 10 个散文件混住。代码里只有 chat 一个域,文档却拆成 `chat/` 和 `messaging/`。`docs/README.md` 是手工维护的索引,且已经漂移:`main-process-architecture.md`、`renderer-architecture.md`、`shared-layer-architecture.md`、`naming-conventions.md` 完全未列入,`chat/message-tree.md` 被列在 Messaging 章节下。根 `CONTRIBUTING.md` 在 `docs/guides/contributing.md` 有一份已经措辞分叉的近似副本,后者的"中文"语言切换链指向它自己——中文版并不存在。

**决策在蒸发。** 理由和被否决的替代方案只存在于 PR 讨论串和聊天里。多个 agent 并行工作时,同一个被否过的主意会被反复提出、反复争论,因为没有任何记录说它输过、为什么输。

**文档是产品,却缺了一半。** Cherry Studio 的用户和贡献者中有很大比例读中文,而语料是约 110 篇英文 markdown,中文对照仅一对(`.agents/skills/README.zh.md`)。

## Proposal

移植 deepseek-harness(dsh)的文档与决策记录流程,并在明确标注处做适配。共六部分,外加推进计划。

### P1 — Target tree

```
docs/
  README.md            # thin index generated from frontmatter descriptions; never hand-edited
  contrib/             # process & repo engineering: contributing pointers, branching-strategy,
                       # development, linux-packaging, test-plan, feishu-notify, app-upgrade
  references/
    architecture/      # architecture-overview, main-process-architecture,
                       # renderer-architecture, shared-layer-architecture, naming-conventions
    <domain>/          # closed set; every domain directory has README.md as the domain home
.agents/notes/         # Agent Notes (decision records) — see P4
```

规则:

- `references/` 顶层是**封闭集**,只允许域目录——不许散文件(门禁校验,与代码树在 naming-conventions §4.8 中已有的封闭集规则呼应)。
- 每个域目录必须有 `README.md` 作为域之家:本域主题写全细节,子级只概括并链接。一个事实,一个家。
- 域目录内的文件名不重复域前缀(`window-manager-usage.md` → `usage.md`);存量带前缀的文件在其所属域的 Phase 0b 搬家窗口一并改名,反正入链当时就要重写。**Phase 0b 的此项决策已被取代:**[已落地的审计结果](../../implemented/process/2026-08-19-phase-0b-doc-audit-outcomes.zh.md)规定,除非搬家或歧义要求改名,否则保留现有 basename。
- 与代码旁 README(`src/main/core/paths/README.md`、`tests/__mocks__/README.md`……)的分工:跨切面或多模块的内容归 `docs/`;模块私有事实住在模块旁边。
- `docs/README.md` 改为生成式薄索引,退役手工维护的表格。

现有文件的处置(在此决定;Phase 0b 执行):

| 文件 | 处置 |
|---|---|
| `references/messaging/message-system.md` | **删除**——描述的系统已被删除。 |
| `guides/middleware.md` | **删除**——描述的系统已被删除;现行中间件事实归 `src/main/ai` 域文档负责。 |
| `guides/contributing.md` | **删除**——根 `CONTRIBUTING.md` 的漂移副本,后者定为唯一的家(GitHub 特殊文件);其中旧双分支时代的"Branch Strategy 🚨"残骸一并清理。中文版在 Phase 2 以根 `CONTRIBUTING.zh.md` 落地。 |
| `references/messaging/composer-rich-clipboard.md` | 移动 → `references/chat/`(它引用的代码全部位于 `components/chat/**` 与 `components/composer/**` 之下)。 |
| `references/fuzzy-search.md` | 移动 → `references/file/`。 |
| `references/ui-semantic-contract.md` | 移动 → `references/components/`。 |
| `references/lan-transfer-protocol.md` | 移动 → `references/lan-transfer/`(协议规范自成一域)。 |
| `references/{architecture-overview,main-process-architecture,renderer-architecture,shared-layer-architecture,naming-conventions}.md` | 移动 → `references/architecture/`。 |
| `guides/{logging,i18n}.md` | 移动 → `references/` 下各自的主题域。 |
| `guides/diagnostics.md` | 归属(contrib 还是 reference)在其 Phase 0b 审计时决定。 |
| `docs/sponsor.md` | **留在 `docs/` 根目录**——根 README 链接的面向用户页面,不是开发者文档;不进参考树、不进门禁、不进双语配对。 |
| `references/chat/{adapters,conventions}.md` | **保持原位**——明确标注为 target-architecture 设计文档;adapters 代码落地时重新决定其归宿。不在 Phase 0b 范围内。**已被[已落地的审计结果](../../implemented/process/2026-08-19-phase-0b-doc-audit-outcomes.zh.md)取代。** |
| `references/file/architecture.md` + `file-manager-architecture.md` | **两篇都保留**——刻意分层且互相声明 SoT 边界,不是腐烂。 |

### P2 — Frontmatter

`docs/references/**` 下每篇文档携带:

```yaml
---
description: One-line summary (feeds the generated index and agent doc catalogs)
sources: # code paths this document describes; directories preferred
  - src/main/services/file/tree/
---
```

`docs/contrib/**` 只要求 `description`。Agent Notes **不用 frontmatter**——路径与 header block 已经编码了它们的元数据,与 dsh 一致。`docs/sponsor.md` 是根 README 链接的面向用户页面,不是开发者文档:它留在 `docs/` 根目录,不在任何门禁的扫描范围内(门禁只覆盖 `references/` 与 `contrib/`),也不进双语配对。

`sources` 的每一条是一个**路径前缀**:diff 路径等于该条或位于其下时即归属该文档,因此目录条目覆盖其全部子孙。这正是 Phase 4 反向查询能对子树改动生效的原因;也正因如此,过宽的条目会稀释信号——每条应写仍能覆盖该文档全部主题的最窄目录。

未来任何字段的准入标准:它必须承载路径、H1、git 都承载不了的信息,**并且**说得出消费它的脚本。现在即拒绝的字段,每个都已有归属:`domain`/`category`(路径)、`title`(H1)、`updated`/`author`(git)、`status: deprecated`(删除——要么是现行事实要么不存在)、`tags`(无消费者)、`sidebar_position`(站点导航集中在一个映射文件,dsh 式),以及翻译配对 hash(把文件的 hash 写进文件本身会改变 hash——它必须住在 sidecar 里)。

### P3 — Gates

三个新脚本,全部是 `tsx scripts/*.ts`,遵循仓库较新的脚本惯例(导出函数 + `scripts/__tests__/` 下的测试,同 `i18n-check-values.ts`):

- `verify-doc-structure`——`references/` 根的封闭集;每个域目录有 `README.md`。
- `verify-doc-frontmatter`——必填字段齐全;每个 `sources` 路径存在。它抓住的是特定一类腐烂:主题已被删除或搬走的文档——`middleware.md` 与 `message-system.md` 正是此类——在代码移动当天即被抓住。**它是存在性检查,不是新鲜度检查**:主题原地变化、或文件在某个宽目录条目内部移动而导致的过时,门禁仍是绿的。语义过时由 Phase 4 的反向查询和评审负责,不在这里。
- `gen-doc-index`(带 `--check`)——从 frontmatter 重新生成 `docs/README.md`;漂移即失败。

接线:新聚合命令 `pnpm docs:check` = `docs:check-links` + 上述三个,并替换 `build:check` 里的裸 `docs:check-links`。补上 CI 缺口需要改**工作流**,而不只是改 script:`.github/workflows/ci.yml` 并不调用 `pnpm ci:basic-check`——它的 `basic-checks` job 通过 `concurrently` 内联各条命令,因此 `docs:check` 必须加进那个步骤才会在 CI 里真正运行。`ci:basic-check` script 同步更新,以保持本地等价物诚实。

`sources` 的后续消费者:把 PR 的 diff 路径与全部 `sources` 清单求交集,即可机械得出"这个 PR 本应更新的文档",接进 `gh-pr-review` skill(Phase 4)。这把"改代码必须带文档"从自觉守则变成可校验的规则。

### P4 — Agent Notes

决策记录住在 `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`:

- **生命周期**:`proposed/`(实现前先评审)→ `implemented/`(已落地,与现实保持同步)或 `rejected/`(被否决;只要其理由还能防住一个诱人的错误就保留)。dsh 的 `archived/` 层缓行,等数量需要时再引入。
- **类别**:`feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`。刻意不设 `refactor` 类——`simplification` 已覆盖它,判据是"可观察行为是否变化?"。
- **格式**:header block(`# Agent Note: <title>`、`Status: <lifecycle>`),然后 `## Problem`、`## Proposal`(proposed)或 `## Decision`(implemented,现在时),自由的技术小节,**强制的 `## Alternatives considered`**,再然后 `## Acceptance criteria` + `## Risks`(proposed)或 `## Consequences`(implemented)。不记录赢过谁的决策,就是在邀请重新争论。
- 决策永不被原地改写成另一个决策:用新 note 取代并互相链接。
- **门槛**(对 dsh 的有意偏离,dsh 要求每个非平凡 PR 必带 note):只对**维护者可能合理地重新质疑的决策**要求 note——架构选择、跨模块契约、数据/磁盘/线上格式、流程变更、被否决的方案。Cherry Studio 的日常修复流量会让逐 PR 强制变成一种税,而不是记录。
- Spec-first 的 feature 流程:大型 feature 从一条 `proposed/` note 开始,实现前先评审,按其自身的 acceptance criteria 验收,落地后改写为 `implemented/`。本 note 就是这个闭环的第一个实例。

格式门禁(移植 dsh 的 `verify-agent-note-format`)与完整的 `.agents/notes/README.md` 规则集一起在 Phase 1 落地。

### P5 — Bilingual pairing

范围内的每篇文档都是英文/中文对照加一个一致性 sidecar:`foo.md` + `foo.zh.md` + `foo.i18n.yaml`,后者记录两侧在最近一次确认一致时的 git blob hash(移植 dsh 的 `verify-translation-pairing`)。任一语言都可以先写;失同步的配对用被改一侧的 diff 去最小化修补另一侧,永不整篇重翻。

范围按发现根逐步扩——这是对 dsh"不设灰度清单"立场的有意偏离:`.agents/notes/**` 和根 `CONTRIBUTING.md` 先行(新语料生而双语),`docs/**` 等 Phase 3 回填完成后再纳入。`docs/i18n/terminology.md` 成为文档翻译的术语源,以 `scripts/i18n-glossary.json` 为种子(其 `terms` 块目前只有五条且不被强制——需要扩充,但它记录的词汇选择,如 Provider=提供商、Agent=智能体,直接沿用)。

### P6 — Skills

把 dsh 的流程 skills 做成 cherry 版本,适配本仓库的领域:find-simplifications skill(把"清理一下"变成有证据支撑的 proposed notes;调查领域换成 renderer hooks、四个数据层、IPC、lifecycle services、v1 迁移残留)、doc-standards/prose-standard skill(层级详略规则、tutorial/reference 分类、slop 检查单),以及 P3 里的 `gh-pr-review` 反向查询集成。

### Rollout

| Phase | 工作 | 验证 |
|---|---|---|
| 0a(本 PR) | 本方案;带 stub README 的 `.agents/notes/` 骨架 | 对本 note 的评审即是决策 |
| 0b | 逐域搬家 + 审计 PR:移动、改名、逐条对照代码验证、重写或删除。**门禁最后落地,在最后一次搬家之后**,与全语料的 frontmatter 一起 —— `verify-doc-structure` 读整个 `references/` 根、`verify-doc-frontmatter` 读每篇参考文档,树迁移到一半时两者都不可能绿;而为这段短暂的迁移期做一套分级放行白名单,机械成本大于收益 | 每个搬家 PR `docs:check-links` 绿;门禁落地后完整 `pnpm docs:check` 绿;搬过的文档所有断言对照 `src/` 验证过 |
| 1 | 完整 `.agents/notes/README.md` 规则集 + 格式门禁 + 回填种子 notes(双语) | 格式门禁对全部 notes 绿 |
| 2 | 配对门禁移植;发现根 `.agents/notes` + `CONTRIBUTING.md`;`CONTRIBUTING.zh.md` | `verify-translation-pairing` 绿 |
| 3 | 只对审定为现行的文档做翻译回填;配对范围扩到 `docs/**` | 全语料配对绿 |
| 4 | 流程 skills + `gh-pr-review` 的 sources 集成 | Skill 评审 |

全程质量先于翻译:一篇文档先审定为现行,再进入配对——翻译腐烂内容等于把它固化成两种语言,纠错成本翻倍。

## Alternatives considered

- **零 frontmatter、纯路径编码元数据(dsh 的设计)。** dsh 把一切编码进路径和 header,其文档不带 frontmatter。此处拒绝,因为我们两个最迫切的需求——腐烂门禁(`sources`)和防漂移的生成式索引(`description`)——都需要逐文件的机器可读字段;dsh 用字数预算、`verify-doc-refs` 和手工层级维护覆盖这些,而那套机械我们并不整体移植。
- **给过时文档打 `status: deprecated` 标记。** 拒绝:要么是现行事实,要么删除。弃用标记是给腐烂发的留存许可证。
- **先翻译,后审计。** 拒绝:此后每次纠错都要付两种语言的成本外加一次配对重录。
- **保留 `guides/` 与 `references/` 的二分。** 拒绝:这个分类已经名存实亡;按用途分类(tutorial = 有序步骤走到可观察结果)一照,这里几乎全是 reference 或流程材料。
- **现在就整体移植 dsh 的翻译机械**(merge driver、`gen-translation-brief`、doc budgets)。缓行:dsh 自己也把重型路径标为仅显式调用;在失同步冲突成为真实成本之前,常规的单遍对照更新就够了。
- **dsh 的逐 PR note 强制令。** 修订为 P4 的决策门槛;以这里的修复流量,强制令会沦为仪式。
- **现在就做网站投影。** 缓行:docs.cherry-ai.com 在独立仓库;等语料被治理之后,投影是另一个独立决策。

## Acceptance criteria

- `references/` 顶层是封闭的域目录集,每域有 README 之家;`verify-doc-structure` 绿。
- 三篇死/重复文档已删除;每篇存活的 reference 文档的断言都对照现行代码验证过。
- 每篇 `references/**` 文档带 `description` + 存在的 `sources`;`verify-doc-frontmatter` 绿。
- `docs/README.md` 是生成的;`gen-doc-index --check` 绿。
- CI 跑 `pnpm docs:check` —— 以 `.github/workflows/ci.yml` 的 `basic-checks` job 确实调用它为准,而不是以 `ci:basic-check` script 列出它为准。
- `.agents/notes/` 持有本 note 加回填的种子,双语,格式门禁绿。
- `.agents/notes/**` 与 `CONTRIBUTING.md` 通过配对门禁;Phase 3 之后 `docs/**` 也通过。

## Risks

- **入链翻新。** `docs:check-links` 只解析 Markdown 链接,因此看不到其余任何消费者:`CLAUDE.md` 正文、`eslint.config.mjs` 里的 lint 规则消息、TypeScript 注释,以及*按路径读取文档*的代码——`scripts/uiContract/__tests__/maintainedAnchors.test.ts` 会打开 `ui-semantic-contract.md`,那里漏改会挂掉一个测试而不是一条链接。因此 Phase 0b 的每次移动都要对旧路径 grep **整个仓库**(`src/`、`scripts/`、`packages/`、`tests/`、`.github/`、根配置),而不只是 `src/`。缓解:按域原子化移动(搬家 + 修复全部入链引用在同一个 PR)。
- **与进行中 PR 的冲突。** 目录树移动会与触及相同文档的在途工作冲突。缓解:Phase 0b 逐域小步推进,不搞一次性大搬家。
- **双语维护成本。** 每次编辑配对文档都要同步另一侧并重录;高频变动的文档付出最多。有意接受——文档在这里是产品——并通过只配对审定为现行的材料来控制上限。
- **翻译评审负担。** 配对门禁校验的是结构而非忠实度;中文质量仍需评审者投入,而术语表起点很薄。
