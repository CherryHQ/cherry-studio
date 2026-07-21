# 迁移诊断文件系统证据与支持邮件设计

## 目标

在不收集绝对路径、原始错误、堆栈、SQL 或用户内容的前提下，让迁移诊断包能够完整识别“导出目录的父节点类型错误”这一失败；同时修复 `mailto:` 空格被 macOS Mail 显示为 `+` 的缺陷，扩展支持邮件模板，并让原生诊断交互与邮件统一使用迁移窗口当前语言。

## 已选方案

采用 Main 侧严格结构化取证。Renderer 继续只报告固定的 `sourceRole` 与 `operationRole`；Main 在执行 `mkdir` 或 `writeFile` 的异常边界保留安全枚举，并只对应用拥有的预定义迁移临时目录执行 `lstat`。诊断证据不保存异常消息、路径、文件名或任意 Renderer 字符串。

曾考虑的替代方案：

- 直接打包原始错误或日志：定位信息最多，但会泄露绝对路径和用户环境，违反现有诊断隐私边界，不采用。
- 只把 `ENOTDIR` 从 `file_missing` 拆成新错误码：能修正分类，但仍不能证明哪个逻辑节点类型错误，覆盖不足，不采用。
- 由 Renderer 补充路径或节点信息：Renderer 不拥有 Main 文件系统真相，且扩大了敏感 IPC 输入面，不采用。

## 文件系统证据

`ENOTDIR` 与 `EEXIST` 归类为新的 `file_invalid_type`。Main 写入失败信息扩展为固定结构：

```ts
{
  errorCode: 'file_invalid_type',
  filesystemEvidence: {
    causeCode: 'ENOTDIR',
    filesystemOperation: 'mkdir',
    targetRole: 'dexie_export_directory',
    blockingNodeRole: 'migration_temp_root',
    expectedNodeType: 'directory',
    observedNodeType: 'file'
  }
}
```

所有字段都是枚举。若路径不是 Main 根据 `userDataPath` 推导出的两个允许导出目录，或安全探测失败，则使用 `unknown` / `unavailable`，不回退到原始路径。`sourceRole`、`operationRole` 和文件系统证据一起写入现有 `renderer_export_failed` evidence。

## 邮件模板与 URI

邮件仍由 Main 使用固定支持邮箱和固定 i18n 资源生成，不允许 Renderer 提供主题或正文。模板自动包含：应用版本、系统与架构、失败 scope/phase、failure kind/errorCode、迁移来源与操作；并提供固定的用户补充问题、手动附 ZIP 提示和隐私说明。

`mailto:` 查询参数使用逐字段 `encodeURIComponent` 百分号编码。空格必须输出 `%20`，不能输出 `+`；换行输出 `%0A`。现有外部 URL 安全校验保留。

## 语言一致性

新增严格的 `zh-CN | en-US` 诊断语言 IPC。迁移窗口初始化及用户切换语言时把当前语言注册到对应 Main 窗口状态。保存诊断包的原生对话框和邮件模板优先使用该状态；Renderer 尚未注册语言的原生 preboot 故障才回退 `app.getLocale()`。

Renderer 只能提交语言枚举，Main 始终从固定资源生成文本，因此不会引入自由文本注入。当前仅有简体中文和英文资源，所有 Renderer 中的中文选择统一为 `zh-CN`。

## 错误处理与隐私

- 文件节点探测失败不能覆盖原始迁移失败，只把 `observedNodeType` 记为 `unavailable`。
- 不在诊断包或邮件中加入绝对路径、basename、权限位、inode、原始 errno message、堆栈或用户数据。
- 未保存诊断包时，现有“在文件夹中显示”保护不变。
- 邮件仍只打开本地草稿，不自动附加、上传或发送 ZIP。

## 测试与验收

- 分类器测试证明 `ENOTDIR` / `EEXIST` 为 `file_invalid_type`，`ENOENT` 仍为 `file_missing`。
- IPC 测试用真实形状的 `ENOTDIR` 和 `lstat` 结果证明完整 evidence，并证明路径/消息未进入能力参数。
- schema、checkpoint、bundle 与 payload profiler 测试接受新白名单字段并继续拒绝隐私 canary。
- 邮件单测直接断言原始 URI 含 `%20` 且不含 `+`，并校验扩展后的中英文模板。
- Renderer/Main 测试证明切换迁移窗口语言后，保存对话框与邮件均采用相同语言；非法语言被拒绝或忽略。
- 手工验收复用 `fresh002`：构造 `migration_temp` 普通文件，确认 ZIP 可直接判断 `ENOTDIR + mkdir + migration_temp_root=file`，并在 Mail 中确认主题/正文无 `+`。
