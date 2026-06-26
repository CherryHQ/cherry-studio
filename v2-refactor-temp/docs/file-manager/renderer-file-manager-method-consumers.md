# Renderer `FileManager` 方法消费者清单

> 用于迁移 `src/renderer/services/FileManager.ts` 的当前快照。
>
> 日期：2026-06-26
> 范围：`src/renderer` 与 renderer 测试里的静态引用。主进程 `src/main/services/file/FileManager.ts` 不在本清单范围内。
>
> 使用的扫描命令：
>
> - `rg "from ['\"]@renderer/services/FileManager['\"]" src tests packages`
> - 逐方法扫描：`rg "\b(FileManager\.|this\.)<method>\b|\b<method>\s*[:=]" src/renderer src/shared tests`
> - 动态索引兜底：`rg "FileManager\[|\[['\"]<method>['\"]\]" src/renderer tests`

## 总览

当前只有 3 个生产文件导入旧 renderer `FileManager`：

| 导入方 | 运行时使用的方法 |
| --- | --- |
| `src/renderer/pages/paintings/components/Artboard.tsx` | `getFileUrl` |
| `src/renderer/pages/paintings/components/PaintingStrip.tsx` | `getFileUrl` |
| `src/renderer/components/chat/messages/hooks/useMessageLeafCapabilities.ts` | `formatFileName` |

唯一的测试 mock：

| 测试 | Mock 的方法 |
| --- | --- |
| `src/renderer/components/chat/messages/hooks/__tests__/useMessageLeafCapabilities.test.tsx` | `formatFileName` |

未发现 `FileManager[...]` 形式的动态调用。

## 本轮已删除的方法

本轮删除了对外无消费者、且只被同样无消费者包装方法牵住的旧 Dexie / IPC 死链路：

| 方法 | 删除原因 |
| --- | --- |
| `selectFiles` | `window.api.file.select` 的旧薄包装；无外部调用。 |
| `addFile` | 旧 Dexie 引用计数写入；仅被已删除的 `addFiles` 牵住。 |
| `addFiles` | 旧批量包装；无外部调用。 |
| `readBinaryImage` | `window.api.file.binaryImage` 的旧薄包装；无外部调用。 |
| `readBase64File` | `window.api.file.base64File` 的旧薄包装；无外部调用。 |
| `addBase64File` | `base64File` 后写 Dexie 的旧入口；无外部调用。 |
| `uploadFile` | 旧 `window.api.file.upload` + Dexie 写入；仅被已删除的 `uploadFiles` 牵住。 |
| `uploadFiles` | 旧批量包装；无外部调用。 |
| `getFile` | 旧 Dexie 查询 + path 合成；仅被已删除的 `deleteFile` 牵住。 |
| `getFilePath` | path 合成 helper；无外部调用。 |
| `deleteFile` | 旧 count 递减 / 永久删除；仅被已删除的 `deleteFiles` 牵住。 |
| `deleteFiles` | 旧批量删除；无外部调用。 |
| `allFiles` | 死的 Dexie `files.toArray()` 包装。 |
| `updateFile` | 旧 Dexie rename 自愈逻辑；无外部调用。 |
| `isDangerFile` | 旧 renderer 侧危险扩展判断；随 `getSafePath` 一起删除，改由 main 的 `safeOpen` / shared `toSafeFileUrl` 策略承接。 |
| `getSafePath` | 聊天附件旧 path 安全包装；已拆为文本预览读取原始 path、默认打开走 `safeOpen(FileHandle)`、图片预览 URL 走 `toSafeFileUrl(path, ext)`。 |

## 剩余方法清单

| 方法 | 外部运行时消费者 | 测试消费者 | 类内部消费者 | 迁移备注 |
| --- | --- | --- | --- | --- |
| `getFileUrl` | `Artboard.tsx:53`, `Artboard.tsx:87`, `PaintingStrip.tsx:45` | 无 | 无 | 仅 paintings 图片展示使用。现有 TODO 指向自定义协议 `cherrystudio://file/internal/...`；过渡期可用 `getPhysicalPath` + safe URL helper。 |
| `formatFileName` | `useMessageLeafCapabilities.ts` | `useMessageLeafCapabilities.test.tsx` mock | 无 | 聊天附件展示名 helper。删除类前迁到聚焦的 renderer/shared display-name helper。 |

## 仅注释引用

这些引用不会让方法保持存活，但解释了当前过渡行为：

| 文件 | 引用说明 |
| --- | --- |
| `src/renderer/pages/paintings/model/mappers/recordToPaintingData.ts` | 说明替代了 v1 `FileManager.getFile(id)` lookup。 |
| `src/renderer/pages/paintings/model/mappers/__tests__/paintingMappers.test.ts` | 说明旧 `FileManager.getFileUrl` 的 URL 构造方式。 |
| `src/renderer/pages/paintings/utils/fileEntryAdapter.ts` | 解释为了兼容 `getFileUrl`，仍合成 `FileMetadata.name = id + ext`。 |
| `src/renderer/pages/paintings/components/Artboard.tsx` | TODO：自定义协议落地后移除 `getFileUrl` 依赖。 |

## 后续建议删除顺序

1. 迁移 `useMessageLeafCapabilities` 里的 `formatFileName`，并同步更新测试 mock。
2. 迁移 paintings 的 `getFileUrl` 消费者（`Artboard`、`PaintingStrip`），目标是自定义协议或 v2 path/URL helper。
3. 若导入归零，再删除 `src/renderer/services/FileManager.ts`。
