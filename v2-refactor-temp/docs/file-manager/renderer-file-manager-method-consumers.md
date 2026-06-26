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

当前没有生产文件导入旧 renderer `FileManager`，`src/renderer/services/FileManager.ts` 已删除。

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
| `formatFileName` | 聊天附件展示名 helper；因唯一消费者是 `useMessageLeafCapabilities`，已内联迁移到该 hook。保留注释说明其 `pasted_text` / `temp_file...image` filename-marker 判断是 legacy 问题，后续应由粘贴生产处提供显式来源/展示名。 |
| `getFileUrl` | paintings 图片展示 helper；已改为使用 `FileMetadata.path`（由 main `getPhysicalPath` 解析）+ shared `toSafeFileUrl(path, ext)`。 |

## 剩余方法清单

无。

## 仅注释引用

这些引用不会让方法保持存活，但解释了当前过渡行为：

| 文件 | 引用说明 |
| --- | --- |
| `src/renderer/pages/paintings/model/mappers/recordToPaintingData.ts` | 说明替代了 v1 `FileManager.getFile(id)` lookup。 |
| `src/renderer/pages/paintings/model/mappers/__tests__/paintingMappers.test.ts` | 说明 paintings 过渡期仍保留 `FileMetadata` 适配形状。 |
| `src/renderer/pages/paintings/utils/fileEntryAdapter.ts` | 解释 `FileEntry` 到 legacy `FileMetadata` 的过渡适配。 |
| `src/renderer/pages/paintings/components/Artboard.tsx` | TODO：自定义协议落地后直接使用 `FileEntry`。 |

## 后续建议

renderer `FileManager` 已删除。后续聚焦 paintings 的 `FileMetadata[]` → `FileEntry[]` 迁移，以及自定义协议 `cherrystudio://file/internal/...` 落地后移除当前 `getPhysicalPath` 预解析。
