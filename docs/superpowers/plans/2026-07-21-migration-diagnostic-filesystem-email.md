# 迁移诊断文件系统证据与支持邮件实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让诊断包完整识别迁移导出目录类型错误，修复 `mailto:` 空格编码并扩展支持邮件模板，使原生诊断语言始终跟随迁移窗口当前语言。

**架构：** Renderer 只注册严格语言枚举和原有导出角色；Main 在文件系统异常边界派生固定 evidence，并从诊断快照与固定 i18n 资源生成邮件。诊断 schema 保持 fail-closed，所有新字段都是枚举，不序列化路径、错误消息或堆栈。

**技术栈：** TypeScript、Electron IPC、React/i18next、Zod、Vitest、Node `fs/promises`。

---

## 文件结构

- 修改 `src/main/data/migration/v2/diagnostics/migrationDiagnosticsSchemas.ts`：新增 `file_invalid_type` 与严格文件系统 evidence。
- 修改 `src/main/data/migration/v2/diagnostics/migrationErrorClassifier.ts`：区分缺失与节点类型错误。
- 修改 `src/main/data/migration/v2/window/MigrationIpcHandler.ts`：采集 Main-owned 文件节点证据、注册语言、生成邮件。
- 创建 `src/main/data/migration/v2/window/migrationDiagnosticEmail.ts`：集中构建固定邮件模板参数和 RFC 兼容 `mailto:`。
- 修改 `src/main/core/preboot/v2MigrationGate.ts`：把结构化 Main failure 合并进诊断快照，并向邮件层提供快照。
- 修改 `src/shared/data/migration/v2/types.ts`：增加严格诊断语言类型与 IPC channel。
- 修改 `src/renderer/windows/migrationV2/MigrationApp.tsx` 与 `hooks/useMigrationProgress.ts`：注册和更新窗口当前语言。
- 修改 `src/main/data/migration/v2/window/migrationDiagnosticNativeI18n.json`：扩展中英文主题与正文。
- 修改相邻测试和 `src/main/data/migration/v2/README.md`：验证并记录新契约。

### 任务 1：文件系统类型错误的严格证据

**文件：**
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/migrationErrorClassifier.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsSchemas.test.ts`
- 修改：`src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts`
- 修改：`src/main/core/preboot/__tests__/v2MigrationGate.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/migrationErrorClassifier.ts`
- 修改：`src/main/data/migration/v2/diagnostics/migrationDiagnosticsSchemas.ts`
- 修改：`src/main/data/migration/v2/core/MigrationEngine.ts`
- 修改：`src/main/data/migration/v2/migrationDiagnostics.ts`
- 修改：`src/main/data/migration/v2/window/MigrationIpcHandler.ts`
- 修改：`src/main/core/preboot/v2MigrationGate.ts`

- [ ] **步骤 1：编写分类与 schema 失败测试**

加入断言：

```ts
expect(classifyMigrationError(Object.assign(new Error('private'), { code: 'ENOTDIR' }))).toEqual({
  errorCode: 'file_invalid_type'
})
expect(classifyMigrationError(Object.assign(new Error('private'), { code: 'EEXIST' }))).toEqual({
  errorCode: 'file_invalid_type'
})
```

并要求 `renderer_export_failed` 接受以下固定 evidence、拒绝 `path` / `message` 等额外字段：

```ts
filesystem: {
  causeCode: 'ENOTDIR',
  filesystemOperation: 'mkdir',
  targetRole: 'dexie_export_directory',
  blockingNodeRole: 'migration_temp_root',
  expectedNodeType: 'directory',
  observedNodeType: 'file'
}
```

- [ ] **步骤 2：运行测试确认红灯**

运行：

```bash
pnpm vitest run src/main/data/migration/v2/diagnostics/__tests__/migrationErrorClassifier.test.ts src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticsSchemas.test.ts
```

预期：`ENOTDIR` 仍返回 `file_missing`，schema 拒绝 `filesystem`。

- [ ] **步骤 3：实现最小分类与 schema**

新增错误码 `file_invalid_type`。文件系统 evidence 只允许规格中的枚举；在 engine/preboot 的数据库或文件错误白名单中加入新错误码。

- [ ] **步骤 4：编写 IPC 失败测试**

在 `MigrationIpcHandler.test.ts` 模拟：

```ts
fsMocks.mkdir.mockRejectedValueOnce(Object.assign(new Error('PRIVATE_PATH'), {
  code: 'ENOTDIR',
  syscall: 'mkdir'
}))
fsMocks.lstat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false })
```

使用允许的 Dexie 导出逻辑路径，断言 capability 收到 `file_invalid_type` 和完整固定 evidence，序列化调用中不出现 `PRIVATE_PATH` 或 `/mock/userData`。

- [ ] **步骤 5：运行 IPC 测试确认红灯**

运行：

```bash
pnpm vitest run src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts
```

预期：能力仍只收到字符串错误码，且没有 `lstat` 证据。

- [ ] **步骤 6：在 Main 异常边界采集最小证据**

把 `mkdir` 与 `writeFile` 拆成可辨识的异常边界。仅当 `exportPath` 等于 Main 从 `userDataPath` 推导出的 Dexie 或 LocalStorage 导出目录时，探测固定 `migration_temp` 根节点；其他路径使用 `unknown` / `unavailable`。把结构化 failure 传给 gate，gate 合并进严格 snapshot。

- [ ] **步骤 7：运行任务 1 测试确认绿灯**

运行任务 1 的四个测试文件，预期全部通过且无隐私 canary 泄漏。

### 任务 2：支持邮件模板与 URI 编码

**文件：**
- 创建：`src/main/data/migration/v2/window/migrationDiagnosticEmail.ts`
- 创建：`src/main/data/migration/v2/window/__tests__/migrationDiagnosticEmail.test.ts`
- 修改：`src/main/data/migration/v2/window/migrationDiagnosticNativeI18n.json`
- 修改：`src/main/data/migration/v2/window/__tests__/migrationDiagnosticNativeI18n.test.ts`
- 修改：`src/main/data/migration/v2/window/MigrationIpcHandler.ts`
- 修改：`src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts`
- 修改：`src/main/core/preboot/v2MigrationGate.ts`

- [ ] **步骤 1：编写邮件失败测试**

测试固定快照生成包含版本、平台、架构、scope/phase、kind/errorCode、source/operation 和用户补充问题的中英文正文。直接断言原始 URI：

```ts
expect(url).toContain('Cherry%20Studio')
expect(url).toContain('%0A')
expect(url).not.toContain('+')
expect(url).not.toContain('/Users/')
```

- [ ] **步骤 2：运行测试确认红灯**

运行：

```bash
pnpm vitest run src/main/data/migration/v2/window/__tests__/migrationDiagnosticEmail.test.ts src/main/data/migration/v2/window/__tests__/migrationDiagnosticNativeI18n.test.ts
```

预期：新模块不存在或现有模板缺少摘要，当前 URL 含 `+`。

- [ ] **步骤 3：实现固定邮件构建器**

新模块接收 `MigrationDiagnosticsSnapshot` 和 native i18n，只读取严格 snapshot 字段；缺失字段输出固定 `unknown`。`mailto:` 使用：

```ts
`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
```

Main 继续执行 `isSafeExternalUrl` 后才调用 `shell.openExternal`。

- [ ] **步骤 4：扩展固定中英文资源**

主题包含错误码、版本、平台；正文包含自动诊断摘要、四项用户补充问题、手动附 ZIP 提示和不自动上传说明。资源不接受 Renderer 自由文本。

- [ ] **步骤 5：运行任务 2 测试确认绿灯**

运行任务 2 全部测试，预期原始 URL 使用 `%20` / `%0A`，模板字段完整。

### 任务 3：迁移窗口语言统一

**文件：**
- 修改：`src/shared/data/migration/v2/types.ts`
- 修改：`src/renderer/windows/migrationV2/hooks/useMigrationProgress.ts`
- 修改：`src/renderer/windows/migrationV2/hooks/__tests__/useMigrationProgress.test.tsx`
- 修改：`src/renderer/windows/migrationV2/MigrationApp.tsx`
- 修改：`src/renderer/windows/migrationV2/__tests__/MigrationApp.test.tsx`
- 修改：`src/main/data/migration/v2/window/MigrationIpcHandler.ts`
- 修改：`src/main/data/migration/v2/window/__tests__/MigrationIpcHandler.test.ts`

- [ ] **步骤 1：编写语言同步失败测试**

要求 action 暴露：

```ts
await result.current.setDiagnosticLocale('zh-CN')
expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.SetDiagnosticLocale, 'zh-CN')
```

Main 测试先注册 `zh-CN`，再保存和打开邮件，断言二者使用中文；非法语言返回 `false` 且不改变已注册语言。

- [ ] **步骤 2：运行测试确认红灯**

运行 Renderer hook、MigrationApp 和 Main IPC 测试，预期缺少 channel/action/state。

- [ ] **步骤 3：实现严格语言注册**

共享类型只允许 `zh-CN | en-US`。MigrationApp 在初始化和 `i18n.language` 变化时注册当前值；Main 把语言保存在当前 `DiagnosticRegistrationState`，保存对话框和邮件均优先使用该值，未注册才使用 `app.getLocale()`。

- [ ] **步骤 4：运行任务 3 测试确认绿灯**

运行三个目标测试文件，预期当前窗口语言覆盖 Main locale，非法值不能进入资源选择。

### 任务 4：契约回归、文档与真实验收

**文件：**
- 修改：`src/main/data/migration/v2/README.md`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticAcceptanceFixtures.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/migrationDiagnosticAcceptance.integration.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/MigrationDiagnosticBundleBuilder.test.ts`
- 修改：`src/main/data/migration/v2/diagnostics/__tests__/payloadLengthProfiler.test.ts`

- [ ] **步骤 1：运行迁移诊断目标测试集**

运行 migration diagnostics、preboot gate、window 和 Renderer migrationV2 的相关 Vitest 文件。任何 strict fixture 失败都按新白名单契约更新，不放宽隐私拒绝测试。

- [ ] **步骤 2：更新 README**

记录 `file_invalid_type`、结构化文件系统 evidence、邮件模板字段、百分号编码和“当前迁移窗口语言优先、Main locale 回退”的规则。

- [ ] **步骤 3：运行仓库要求的完整验证**

依次运行：

```bash
pnpm lint
pnpm test
pnpm format
pnpm build:check
```

若格式命令写入文件，重新运行受影响测试，并确认 `git diff --check` 通过。

- [ ] **步骤 4：真实 `fresh002` 验收**

备份隔离目录，设置失败状态并把 `migration_temp` 构造成普通文件，使用：

```bash
CS_DEV_USER_DATA_SUFFIX=fresh002 pnpm dev
```

用 Computer Use 点击迁移、保存 ZIP、打开 Mail。验收：ZIP 显示 `file_invalid_type / ENOTDIR / mkdir / migration_temp_root / file`；邮件跟随窗口语言；主题正文无 `+`；ZIP 可手动附加。退出后恢复原 `fresh002`。

- [ ] **步骤 5：提交实现**

```bash
git add docs/superpowers/plans/2026-07-21-migration-diagnostic-filesystem-email.md src/main/core/preboot src/main/data/migration/v2 src/renderer/windows/migrationV2 src/shared/data/migration/v2
git commit --signoff -m "feat(migration-diagnostics): expand filesystem and email evidence"
```
