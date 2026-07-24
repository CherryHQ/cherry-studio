# 透明窗口默认开启设计

## 目标

将“设置 → 显示与语言 → 透明窗口”的默认值由关闭改为开启。新安装、尚未持久化
`ui.window_style` 的用户，以及 v1 → v2 迁移时缺少该源值的用户使用新默认值；已有
`ui.window_style` 记录保持不变。

## 现状

- `v2-refactor-temp/tools/data-classify/data/classification.json` 是 Preference 默认值的
  source of truth，`src/shared/data/preference/preferenceSchemas.ts` 是生成产物。
- 设置开关仅在 macOS 渲染，`useMacTransparentWindow` 还会通过 `isMac` 再次限制
  透明样式生效。
- macOS 使用 Electron vibrancy 和半透明渲染层背景实现玻璃效果，原生窗口本身仍是
  `transparent: false`。
- Windows 使用 Mica 或实色背景，不读取该偏好来选择窗口材质。
- PreferenceSeeder 只插入缺失项，不覆盖已经持久化的值。

## 方案

将 `classification.json` 中 `ui.window_style` 对应的 `defaultValue` 从 `opaque` 改为
`transparent`，再运行数据分类生成器更新 `preferenceSchemas.ts`。在
`src/shared/data/preference/__tests__/preferenceSchemas.test.ts` 中增加聚焦断言，锁定
新用户的透明窗口默认值。

不修改 Electron 窗口选项、平台判断、设置 UI、迁移映射或 PreferenceSeeder。

## 备选方案

1. 在 macOS 设置页面挂载时写入 `transparent`：会引入 UI 初始化副作用，并可能覆盖
   用户明确保存的 `opaque`。
2. 在 PreferenceService 中增加平台感知默认值：会将功能默认值扩散到共享持久化
   基础设施，且静态 schema、迁移和运行时默认值容易不一致。
3. 新增布尔 Preference 并迁移旧值：现有 `WindowStyle` 已能准确表达需求，新增键没有
   独立价值。

采用直接修改生成源的方案，改动最小且保持现有数据链路一致。

## 平台影响

### macOS

Electron 支持 macOS vibrancy，现有主窗口、设置窗口和子窗口已经配置并消费该效果。
新默认值会让未设置用户直接进入现有透明样式。主要风险是复杂桌面背景下的视觉
对比度下降，用户仍可通过设置开关关闭。

### Windows

当前不会产生可见变化：设置开关不渲染，`useMacTransparentWindow` 始终返回 false，
窗口继续使用 Mica 或实色背景。数据库可能保存当前在 Windows 上无效的
`transparent` 值；若未来扩展 Windows 真透明窗口，必须重新评估该默认值和 Electron
透明窗口限制。

## 数据兼容性

- 已有 Preference 行不会被 Seeder 覆盖，因此现有用户选择保持不变。
- v1 → v2 迁移存在 `windowStyle` 时继续迁移原值；缺少源值时使用新的
  `transparent` 默认值。
- 不需要数据库 schema 或 SQL migration。

## 验证

1. 先添加期望 `transparent` 的单元测试并确认其因当前 `opaque` 默认值失败。
2. 修改生成源并重新生成产物。
3. 运行聚焦的 shared Preference schema 测试并确认通过。
4. 检查生成 diff 仅包含预期默认值变化，运行相关格式与静态检查；按用户要求不运行
   全量测试。

## 参考资料

- [Electron BaseWindowConstructorOptions](https://www.electronjs.org/docs/latest/api/structures/base-window-options)
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron Custom Window Styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
