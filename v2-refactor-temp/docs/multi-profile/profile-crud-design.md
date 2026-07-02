# Profile 管理 CRUD 设计

把 profile 的增删改查与切换暴露给用户。建立在隔离地基（[design.md](./design.md)）之上：`ProfileService` 已有 create / list / rename / switch，本文补 delete、IPC 接口、以及一个临时测试 UI。代码标识符与类型保持英文。

**提交范围**：主进程（`deleteProfile`）与 IPC 接口**提交**；测试 UI（§4）是一次性验证用途，**不提交**。

## 1. 现有运行时接口（隔离地基已提供）

`ProfileService`（`core/profile/`）：

- `createProfile(name): ProfileEntry` — 生成 8 位 nanoid，写注册表。
- `listProfiles(): ProfileEntry[]` / `getActiveProfileId(): string`。
- `renameProfile(id, name): void`。
- `switchProfile(targetId): Promise<void>` — 运行时切换（收敛回滚，§ design.md 8）。
- `isSwitching(): boolean`。

## 2. 主进程：deleteProfile

```ts
deleteProfile(id: string): Promise<void>
```

**守卫**（拒绝并抛错，不静默）：

- `id === activeProfileId` → 拒绝：不能删当前激活的 profile（须先切走）。
- `id === DEFAULT_PROFILE_ID` → 拒绝：默认 profile 映射到 legacy 数据根，是零迁移的落点，不可删。
- `id` 不存在 → 拒绝。

**步骤**（顺序保证崩溃安全）：

1. 先从注册表移除该 entry 并 `writeProfileRegistry`（提交）。
2. 再删除其磁盘数据（见 §5 未决）。

先改注册表、后删目录：若第 2 步失败，留下一个孤儿目录（可后续清理、无害）；反之（先删目录、后写注册表失败）会让注册表指向一个已被删数据的 profile，更糟。

**为何删非激活 profile 是安全的**：只有**激活** profile 的库被 `DbService` 打开、Data 目录被 owner 持有；非激活 profile 的 `Profiles/<id>/` 无任何打开的句柄/watcher，可直接删。守卫已排除删激活 profile，故不存在删一个正在被写的目录。

## 3. IPC：IpcApi profile 命名空间

profiles 存于 `profiles.json`、**不是 SQLite 表**，按边界规则走 **IpcApi 不走 DataApi**。`src/shared/ipc/schemas/profile.ts` + `src/main/ipc/handlers/profile.ts`，薄适配层委托 `ProfileService`：

| route | input | output |
|---|---|---|
| `profile.list` | void | `{ activeProfileId, profiles: ProfileEntry[] }` |
| `profile.create` | `{ name }` | `ProfileEntry` |
| `profile.rename` | `{ id, name }` | void |
| `profile.delete` | `{ id }` | void |
| `profile.switch` | `{ id }` | void（切换期间主窗口 reload，调用方不观察其 resolve） |
| `profile.get_active` | void | `string` |

切换会整窗 reload，重载后的渲染层在 boot 时重新 `profile.list`，故不需要 `profile.switched` 事件来驱动 UI（保持最小）。

## 4. 临时测试 UI（不提交）

仅供实机验证切换/增删——这是静态 review 替代不了的信号。参照飞书左下角那排租户切换图标：

- 侧边栏**左下角**竖排若干小的 profile 图标（当前 profile 高亮）+ 一个 `+`。
- 点某个 profile → `ipcApi.request('profile.switch', { id })` → 主窗口 reload 到该 profile。
- `+` → 弹一个名字输入 → `profile.create` → 刷新列表。
- 右键/长按 → rename / delete（delete 走 §5 定的语义 + 二次确认）。
- 切换进行中用 `profile.isSwitching`（经 `profile.get_active` 轮询或一个查询）置灰。

该 UI 是一次性验证脚手架，**不提交**；正式的 profile 管理界面是独立后续工作（RFC §1 UI 属地基范围外）。

## 5. 未决问题

- **删除数据语义**（待定）：
  - 硬删 —— `rm -rf Profiles/<id>/`，不可逆，UI 二次确认；
  - 软删 —— 只移注册表，目录留盘（会积孤儿目录）；
  - 回收站 —— 移到 `.trash/` 保留一段时间。
  三选一未定；`deleteProfile` 的步骤 2 按选定语义实现。
- **名称唯一性**：允许重名（id 已唯一）仅要求非空，或强制唯一。倾向允许重名。
- **默认 profile 改名**：`default` id 保留不变，其 `name` 是否允许用户改（倾向允许，只是 label）。

## 6. 不变量

| 不变量 | 强制手段 |
|---|---|
| 不能删激活 profile | `deleteProfile` 守卫；测试断言拒绝 |
| 不能删默认 profile | `deleteProfile` 守卫；测试断言拒绝 |
| 删除先提交注册表、后删目录 | 顺序固定；测试注入删目录失败，断言注册表已移除该 entry |
| `activeProfileId` 始终指向存在的 profile | 删除不能删激活项（守卫）+ `readProfileRegistry` normalize 兜底 |

## 7. 测试

- `deleteProfile`：删非激活成功（entry 移除 + 目录删）；删激活/默认/未知被拒；删目录失败时 entry 仍已移除。
- IpcApi profile handlers：各 route 委托到 `ProfileService` 对应方法。
- UI 不提交、不计入测试。
