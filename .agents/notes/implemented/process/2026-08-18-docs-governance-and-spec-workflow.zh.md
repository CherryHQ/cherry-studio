# Agent Note: Docs governance and spec-driven workflow

Status: implemented

[English](2026-08-18-docs-governance-and-spec-workflow.md) | 中文

## Problem

本仓库的开发者文档有四个相互关联的缺陷,而且没有任何机制能发现它们。

**文档在无声地腐烂。** `docs/guides/middleware.md` 在教已删除的 v1 `AiProviderMiddlewareTypes` 中间件系统(`src/` 中零命中)。`docs/references/messaging/message-system.md` 描述的 Redux + IndexedDB 消息存储早已不存在:仓库没有 `@reduxjs/toolkit` 依赖,没有 `messageThunk.ts`,没有 `src/renderer/store/`。这两篇在贡献者和 agent 眼里都是现行权威。唯一的文档门禁 `docs:check-links` 只校验链接目标存在——仅此而已——而且 CI 根本不跑它:`ci:basic-check` 覆盖 lint、format、typecheck、i18n 和 skills,不含文档。

**层级在误导读者。** `guides/` 与 `references/` 的二分并不成立:`guides/` 里大多是流程规范(contributing、branching-strategy、test-plan)和用法参考(logging、i18n、diagnostics),不是教程。`references/` 顶层是开放集,17 个域目录与 10 个散文件混住。代码里只有 chat 一个域,文档却拆成 `chat/` 和 `messaging/`。`docs/README.md` 是手工维护的索引,且已经漂移:`main-process-architecture.md`、`renderer-architecture.md`、`shared-layer-architecture.md`、`naming-conventions.md` 完全未列入,`chat/message-tree.md` 被列在 Messaging 章节下。根 `CONTRIBUTING.md` 在 `docs/guides/contributing.md` 有一份已经措辞分叉的近似副本,后者的"中文"语言切换链指向它自己——中文版并不存在。

**决策在蒸发。** 理由和被否决的替代方案只存在于 PR 讨论串和聊天里。多个 agent 并行工作时,同一个被否过的主意会被反复提出、反复争论,因为没有任何记录说它输过、为什么输。

**文档是产品,却缺了一半。** Cherry Studio 的用户和贡献者中有很大比例读中文,而语料是约 110 篇英文 markdown,中文对照仅一对(`.agents/skills/README.zh.md`)。

## Decision

Cherry Studio 使用经过明确适配的 deepseek-harness(dsh)文档与决策记录流程。实现分为六部分。

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
- 域目录内的文件名不重复域前缀(`window-manager-usage.md` → `usage.md`);存量带前缀的文件在其所属域的 Phase 0b 搬家窗口一并改名,反正入链当时就要重写。**Phase 0b 的此项决策已被取代:**[已落地的审计结果](./2026-08-19-phase-0b-doc-audit-outcomes.md)规定,除非搬家或歧义要求改名,否则保留现有 basename。
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
| `references/chat/{adapters,conventions}.md` | **保持原位**——明确标注为 target-architecture 设计文档;adapters 代码落地时重新决定其归宿。不在 Phase 0b 范围内。**已被[已落地的审计结果](./2026-08-19-phase-0b-doc-audit-outcomes.md)取代。** |
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

- **生命周期**:`proposed/`(已批准但实现未完成的目标)→ `implemented/`(已发布,与现实保持同步)或 `rejected/`(由人类明确否决;理由还能防住诱人错误时保留)。dsh 的 `archived/` 层缓行,等数量需要时再引入。
- **类别**:`feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`。刻意不设 `refactor` 类——`simplification` 已覆盖它,判据是"可观察行为是否变化?"。
- **格式**:header block、`Problem`、生命周期专属决策小节、强制 `Alternatives considered`,以及 implemented note 的实际 `Verification`。Proposed acceptance criteria 使用连续 AC ID 和可观察结果,而不是实现任务。
- 决策永不被原地改写成另一个决策:用新 note 取代并互相链接。
- **门槛**:每个人工创建的 PR 声明 Agent Note 或明确 `N/A`;自动化创建的 PR(仓库 workflow 与 Dependabot)免除此元数据要求,但不免除常规验证。只有维护者可能合理重新质疑的决策必须写 note。恢复已有契约的简单 bugfix 使用 `N/A`;具有持久失败、兼容、并发、所有权或替代方案理由的修复在同一 PR 写 implemented `bug-fix` note。
- **Spec-first stack**:重大 feature、architecture、process 和 simplification 从底层 Spec PR 开始。当前 head 得到人类明确 Approval 后才能在上面堆叠 implementation branch;Spec 实质修改需要重新批准。Agent 检查 stack 拓扑与 downstack 的实际证据;中间层保持 note 为 proposed,只有累计覆盖全部 AC 的最终层才把它重写为 implemented。
- **否决**:讨论与 `CHANGES_REQUESTED` 不触发 rejection。只有明确人类决策能把 Spec 移到 `rejected/`;无持久价值的废弃探索直接关闭,不向仓库加入噪音。

完整规则位于 `.agents/notes/README.md`;subtree `AGENTS.md` 自动加载生命周期指令,`verify-agent-note-format` 对机器可检查骨架做门禁,`agent-notes:check-transition` 则根据显式 Spec ref 校验三件套移动和完整 AC 映射。

### P5 — Bilingual pairing

范围内的每篇文档都是英文/中文对照加一个一致性 sidecar:`foo.md` + `foo.zh.md` + `foo.i18n.yaml`,后者记录两侧在最近一次确认一致时的 git blob hash(移植 dsh 的 `verify-translation-pairing`)。任一语言都可以先写;失同步的配对用被改一侧的 diff 去最小化修补另一侧,永不整篇重翻。

范围按发现根逐步扩——这是对 dsh"不设灰度清单"立场的有意偏离:active `.agents/notes/**`、根 `CONTRIBUTING.md` 和新 `docs/i18n/**` 治理文档先行,最终翻译回填后才扩到已审计文档语料。`scripts/i18n-glossary.json` 保持机器术语 owner;`docs/i18n/terminology.md` 是由它生成的双语 agent 视图。

常规门禁检查 hash、switcher、Markdown 结构和 Cherry frontmatter。Staged-index 模式防止 partial commit。Merge driver、snapshot ref、translation brief 生成和自动语义翻译继续延后,直到出现可测需求。

### P6 — Skills

五个 public skill 让政策可执行:`agent-notes`、`docs-governance`、`translate-docs`、`find-simplifications` 和 `gh-stack`。仓库自带的 stack skill 让全新 checkout 能获得扩展安装和非交互式 stack 操作规则,`gh-create-pr` 则继续拥有 Cherry PR 模板和生命周期检查。根与 subtree 指令把日常工作路由到这些 skill,不依赖记忆或开发者全局配置。

一个零依赖 `change:scope` 报告统一 base/head 解析和 committed/staged/unstaged/untracked path。`docs:affected`、PR 创建、PR review、生命周期转换检查和 post-stack 验证共同消费。生成的 `docs/sources-index.json` 把 source prefix 映射到候选文档;`gh-pr-review` 把命中视为必须进行的语义检查,而不是自动 CI 失败。

### Delivery state

| Phase | 工作 | 验证 |
|---|---|---|
| 0a | 已批准方案与 `.agents/notes/` 骨架 | 由 Spec PR #18843 完成 |
| 0b | 逐域搬家与事实审计 | 已完成;结果记录在 implemented 审计 note 中 |
| 1 | 完整 Agent Note 规则、生命周期指令、AC/Verification 格式与格式门禁 | 已实现 |
| 2 | Pairing 与 staged guard、文档治理、change scope、source-impact review、PR/review 集成和生命周期自动化 | 由此最终层实现 |
| 3 | 最终翻译回填已审计现行文档;扩展 pairing roots 与本地化生成导航 | 有意延后 |

全程质量先于翻译:一篇文档先审定为现行,再进入配对——翻译腐烂内容等于把它固化成两种语言,纠错成本翻倍。

## Alternatives considered

- **零 frontmatter、纯路径编码元数据(dsh 的设计)。** dsh 把一切编码进路径和 header,其文档不带 frontmatter。此处拒绝,因为我们两个最迫切的需求——腐烂门禁(`sources`)和防漂移的生成式索引(`description`)——都需要逐文件的机器可读字段;dsh 用字数预算、`verify-doc-refs` 和手工层级维护覆盖这些,而那套机械我们并不整体移植。
- **给过时文档打 `status: deprecated` 标记。** 拒绝:要么是现行事实,要么删除。弃用标记是给腐烂发的留存许可证。
- **先翻译,后审计。** 拒绝:此后每次纠错都要付两种语言的成本外加一次配对重录。
- **保留 `guides/` 与 `references/` 的二分。** 拒绝:这个分类已经名存实亡;按用途分类(tutorial = 有序步骤走到可观察结果)一照,这里几乎全是 reference 或流程材料。
- **现在就整体移植 dsh 的翻译机械**(merge driver、`gen-translation-brief`、doc budgets)。缓行:dsh 自己也把重型路径标为仅显式调用;在失同步冲突成为真实成本之前,常规的单遍对照更新就够了。
- **dsh 的逐 PR note 强制令。** 修订为 P4 的决策门槛;以这里的修复流量,强制令会沦为仪式。
- **现在就做网站投影。** 缓行:docs.cherry-ai.com 在独立仓库;等语料被治理之后,投影是另一个独立决策。

## Consequences

- **入链翻新。** `docs:check-links` 只解析 Markdown 链接,因此看不到其余任何消费者:`CLAUDE.md` 正文、`eslint.config.mjs` 里的 lint 规则消息、TypeScript 注释,以及*按路径读取文档*的代码——`scripts/uiContract/__tests__/maintainedAnchors.test.ts` 会打开 `ui-semantic-contract.md`,那里漏改会挂掉一个测试而不是一条链接。因此 Phase 0b 的每次移动都要对旧路径 grep **整个仓库**(`src/`、`scripts/`、`packages/`、`tests/`、`.github/`、根配置),而不只是 `src/`。缓解:按域原子化移动(搬家 + 修复全部入链引用在同一个 PR)。
- **与进行中 PR 的冲突。** 目录树移动会与触及相同文档的在途工作冲突。缓解:Phase 0b 逐域小步推进,不搞一次性大搬家。
- **双语维护成本。** 每次编辑配对文档都要同步另一侧并重录;高频变动的文档付出最多。有意接受——文档在这里是产品——并通过只配对审定为现行的材料来控制上限。
- **翻译评审负担。** 配对门禁校验的是结构而非忠实度;中文质量仍需评审者投入,而术语表起点很薄。
- **由 agent 负责 PR 元数据。** 人工 PR 通过模板和仓库 skill 携带 Note/Spec/AC/Verification。自动化创建的 PR(仓库 workflow 与 Dependabot)免除该要求,也不再有通用 PR-description Action;人工元数据错误仍由 review 负责发现。
- **生命周期自动化刻意受限。** 转换检查器证明已声明的三件套移动与 AC 映射内部完整。人类 Approval 和当前层是否真是最终层,仍根据实时 GitHub review 与 stack 证据判断。
- **Phase 3 保持独立。** 已审计语料尚未全部翻译;扩展发现根仍是后续变更,继续复用同一 pairing 与 terminology 架构。

## Verification

- AC1 — [Phase 0b 审计结果](./2026-08-19-phase-0b-doc-audit-outcomes.md)加 `pnpm docs:check`:保留逐域审计记录,并拒绝结构或链接回归。
- AC2 — `pnpm exec vitest run --project scripts scripts/__tests__/verify-doc-frontmatter.test.ts scripts/__tests__/gen-doc-index.test.ts scripts/__tests__/find-affected-docs.test.ts` 加 `pnpm docs:check`:捕获缺失的 source owner 和过时的生成索引。
- AC3 — `pnpm exec vitest run --project scripts scripts/__tests__/verify-agent-note-format.test.ts scripts/__tests__/verify-agent-note-transitions.test.ts` 加 `pnpm docs:check`:捕获无效生命周期结构、fenced-code 伪装、非法移动和不完整 AC 证据。
- AC4 — `pnpm exec vitest run --project scripts scripts/__tests__/translation-pairing.test.ts` 加 `pnpm docs:check`:捕获不完整三件套、配对结构不一致、过时 hash 以及 staged hook 使用的 index/worktree 不一致。
- AC5 — `pnpm exec vitest run --project scripts scripts/__tests__/change-scope.test.ts scripts/__tests__/find-affected-docs.test.ts` 加 `pnpm skills:check`:捕获 scope plane 错误,并让 PR/review/stack consumer 始终使用显式 base。
- AC6 — `pnpm skills:check` 加 `pnpm docs:check`:校验携带 Note、Spec、AC、实际 verification、自动化豁免和最终 note 现实的 agent 入口与双语 workflow 契约。
- AC7 — `pnpm exec vitest run --project scripts scripts/__tests__/translation-pairing.test.ts` 加 `pnpm docs:check`:保持 discovery root 由 manifest 驱动,使 Phase 3 无需替换架构即可扩展语料。
