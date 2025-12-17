# Cherry Studio 局域网传输协议规范

> 版本: 3.0
> 最后更新: 2025-12

本文档定义了 Cherry Studio 桌面客户端（Electron）与移动端（Expo）之间的局域网文件传输协议。

---

## 目录

1. [协议概述](#1-协议概述)
2. [服务发现（Bonjour/mDNS）](#2-服务发现bonjourmdns)
3. [TCP 连接与握手](#3-tcp-连接与握手)
4. [消息格式规范](#4-消息格式规范)
5. [文件传输协议](#5-文件传输协议)
6. [心跳与连接保活](#6-心跳与连接保活)
7. [错误处理](#7-错误处理)
8. [常量与配置](#8-常量与配置)
9. [完整时序图](#9-完整时序图)
10. [移动端实现指南](#10-移动端实现指南)

---

## 1. 协议概述

### 1.1 架构角色

| 角色                 | 平台            | 职责                         |
| -------------------- | --------------- | ---------------------------- |
| **Client（客户端）** | Electron 桌面端 | 扫描服务、发起连接、发送文件 |
| **Server（服务端）** | Expo 移动端     | 发布服务、接受连接、接收文件 |

### 1.2 协议栈（v3）

```
┌─────────────────────────────────────┐
│     应用层（文件传输）                │
├─────────────────────────────────────┤
│     消息层（控制: JSON \n）           │
│             （数据: 二进制帧）        │
│     v3: 流式传输，无逐块确认          │
├─────────────────────────────────────┤
│     传输层（TCP）                    │
├─────────────────────────────────────┤
│     发现层（Bonjour/mDNS）           │
└─────────────────────────────────────┘
```

### 1.3 通信流程概览

```
1. 服务发现 → 移动端发布 mDNS 服务，桌面端扫描发现
2. TCP 握手 → 建立连接，交换设备信息（`version=3`）
3. 文件传输 → 控制消息使用 JSON，`file_chunk` 使用二进制帧连续发送（无需等待确认）
4. 连接保活 → ping/pong 心跳
```

### 1.4 安全说明

该协议默认运行在**可信局域网**环境：协议本身不提供传输加密、身份鉴权或防中间人攻击能力。若需要在不可信网络使用，建议在握手阶段增加一次性配对码/Token，并在传输层使用 TLS 或对文件数据进行端到端加密。

---

## 2. 服务发现（Bonjour/mDNS）

### 2.1 服务类型

| 属性         | 值                   |
| ------------ | -------------------- |
| 服务类型     | `cherrystudio`       |
| 协议         | `tcp`                |
| 完整服务标识 | `_cherrystudio._tcp` |

### 2.2 服务发布（移动端）

移动端需要通过 mDNS/Bonjour 发布服务：

```typescript
// 服务发布参数
{
  name: "Cherry Studio Mobile",    // 设备名称
  type: "cherrystudio",            // 服务类型
  protocol: "tcp",                 // 协议
  port: 53317,                     // TCP 监听端口
  txt: {                           // TXT 记录（可选）
    version: "3",
    platform: "ios"                // 或 "android"
  }
}
```

### 2.3 服务发现（桌面端）

桌面端扫描并解析服务信息：

```typescript
// 发现的服务信息结构
type LocalTransferPeer = {
  id: string; // 唯一标识符
  name: string; // 设备名称
  host?: string; // 主机名
  fqdn?: string; // 完全限定域名
  port?: number; // TCP 端口
  type?: string; // 服务类型
  protocol?: "tcp" | "udp"; // 协议
  addresses: string[]; // IP 地址列表
  txt?: Record<string, string>; // TXT 记录
  updatedAt: number; // 发现时间戳
};
```

### 2.4 IP 地址选择策略

当服务有多个 IP 地址时，优先选择 IPv4：

```typescript
// 优先选择 IPv4 地址
const preferredAddress = addresses.find((addr) => isIPv4(addr)) || addresses[0];
```

---

## 3. TCP 连接与握手

### 3.1 连接建立

1. 客户端使用发现的 `host:port` 建立 TCP 连接
2. 连接成功后立即发送握手消息
3. 等待服务端响应握手确认

### 3.2 握手消息（协议版本 v3）

#### Client → Server: `handshake`

```typescript
type LanTransferHandshakeMessage = {
  type: "handshake";
  deviceName: string; // 设备名称
  version: string; // 协议版本，当前为 "3"
  platform?: string; // 平台：'darwin' | 'win32' | 'linux'
  appVersion?: string; // 应用版本
};
```

**示例：**

```json
{
  "type": "handshake",
  "deviceName": "Cherry Studio 1.7.2",
  "version": "3",
  "platform": "darwin",
  "appVersion": "1.7.2"
}
```

### 4. 消息格式规范（混合协议）

v3 采用"控制 JSON + 二进制数据帧"的混合协议，支持流式传输：

- **控制消息**（握手、心跳、file_start/ack、file_end、file_complete、file_cancel）：UTF-8 JSON，`\n` 分隔
- **数据消息**（`file_chunk`）：二进制帧，使用 Magic + 总长度做分帧，连续发送无需等待确认

### 4.1 控制消息编码（JSON + `\n`）

| 属性       | 规范         |
| ---------- | ------------ |
| 编码格式   | UTF-8        |
| 序列化格式 | JSON         |
| 消息分隔符 | `\n`（0x0A） |

```typescript
function sendControlMessage(socket: Socket, message: object): void {
  socket.write(`${JSON.stringify(message)}\n`);
}
```

### 4.2 `file_chunk` 二进制帧格式

为解决 TCP 分包/粘包并消除 Base64 开销，`file_chunk` 采用带总长度的二进制帧：

```
┌──────────┬──────────┬────────┬───────────────┬──────────────┬────────────┬───────────┐
│ Magic    │ TotalLen │ Type   │ TransferId Len│ TransferId   │ ChunkIdx   │ Data      │
│ 0x43 0x53│ (4B BE)  │ 0x01   │ (2B BE)       │ (UTF-8)      │ (4B BE)    │ (raw)     │
└──────────┴──────────┴────────┴───────────────┴──────────────┴────────────┴───────────┘
```

| 字段           | 大小 | 说明                                        |
| -------------- | ---- | ------------------------------------------- |
| Magic          | 2B   | 常量 `0x43 0x53` ("CS"), 用于区分 JSON 消息 |
| TotalLen       | 4B   | Big-endian，帧总长度（不含 Magic/TotalLen） |
| Type           | 1B   | `0x01` 代表 `file_chunk`                    |
| TransferId Len | 2B   | Big-endian，transferId 字符串长度           |
| TransferId     | nB   | UTF-8 transferId（长度由上一字段给出）      |
| ChunkIdx       | 4B   | Big-endian，块索引，从 0 开始               |
| Data           | mB   | 原始文件二进制数据（未编码）                |

> 计算帧总长度：`TotalLen = 1 + 2 + transferIdLen + 4 + dataLen`（即 Type~Data 的长度和）。

### 4.3 消息解析策略

1. 读取 socket 数据到缓冲区；
2. 若前两字节为 `0x43 0x53` → 按二进制帧解析：
   - 至少需要 6 字节头（Magic + TotalLen），不足则等待更多数据
   - 读取 `TotalLen` 判断帧整体长度，缓冲区不足则继续等待
   - 解析 Type/TransferId/ChunkIdx/Data，并传入文件接收逻辑
3. 否则若首字节为 `{` → 按 JSON + `\n` 解析控制消息
4. 其它数据丢弃 1 字节并继续循环，避免阻塞。

### 4.4 消息类型汇总（v3）

| 类型             | 方向            | 编码     | 用途                           |
| ---------------- | --------------- | -------- | ------------------------------ |
| `handshake`      | Client → Server | JSON+\n  | 握手请求（version=3）          |
| `handshake_ack`  | Server → Client | JSON+\n  | 握手响应                       |
| `ping`           | Client → Server | JSON+\n  | 心跳请求                       |
| `pong`           | Server → Client | JSON+\n  | 心跳响应                       |
| `file_start`     | Client → Server | JSON+\n  | 开始文件传输                   |
| `file_start_ack` | Server → Client | JSON+\n  | 文件传输确认                   |
| `file_chunk`     | Client → Server | 二进制帧 | 文件数据块（连续发送，无确认） |
| `file_end`       | Client → Server | JSON+\n  | 文件传输结束                   |
| `file_complete`  | Server → Client | JSON+\n  | 传输完成结果                   |
| `file_cancel`    | Client → Server | JSON+\n  | 取消传输                       |

```
{"type":"message_type",...其他字段...}\n
```

### 4.5 消息发送

```typescript
function sendMessage(socket: Socket, message: object): void {
  const payload = JSON.stringify(message);
  socket.write(`${payload}\n`);
}
```

### 4.6 消息接收与解析（v3 混合协议）

```typescript
const MAGIC = Buffer.from([0x43, 0x53]); // "CS"
let buffer = Buffer.alloc(0);

socket.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (buffer.length > 0) {
    // 检查是否为二进制帧（Magic: 0x43 0x53）
    if (buffer.length >= 2 && buffer[0] === 0x43 && buffer[1] === 0x53) {
      // 需要至少 6 字节头（Magic + TotalLen）
      if (buffer.length < 6) break;

      const totalLen = buffer.readUInt32BE(2);
      const frameLen = 6 + totalLen; // Magic(2) + TotalLen(4) + payload

      if (buffer.length < frameLen) break; // 等待更多数据

      // 解析二进制帧
      const type = buffer[6];
      const transferIdLen = buffer.readUInt16BE(7);
      const transferId = buffer.slice(9, 9 + transferIdLen).toString("utf8");
      const chunkIndex = buffer.readUInt32BE(9 + transferIdLen);
      const data = buffer.slice(13 + transferIdLen, frameLen);

      handleBinaryChunk(transferId, chunkIndex, data);
      buffer = buffer.slice(frameLen);
    }
    // 检查是否为 JSON 控制消息（以 '{' 开头）
    else if (buffer[0] === 0x7b) {
      // '{' = 0x7b
      const newlineIndex = buffer.indexOf(0x0a); // '\n' = 0x0a
      if (newlineIndex === -1) break; // 等待完整的 JSON 行

      const line = buffer.slice(0, newlineIndex).toString("utf8").trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        const message = JSON.parse(line);
        handleMessage(message);
      }
    }
    // 其他数据丢弃 1 字节，继续解析
    else {
      buffer = buffer.slice(1);
    }
  }
});
```

---

## 5. 文件传输协议

### 5.1 传输流程（v3 流式传输）

```
Client (Sender)                     Server (Receiver)
     |                                    |
     |──── 1. file_start ────────────────>|
     |      (文件元数据)                   |
     |                                    |
     |<─── 2. file_start_ack ─────────────|
     |      (接受/拒绝)                    |
     |                                    |
     |══════ 连续发送数据块（无确认）═══════|
     |                                    |
     |──── 3. file_chunk [0] ────────────>|
     |──── 3. file_chunk [1] ────────────>|
     |──── 3. file_chunk [2] ────────────>|
     |      ... 连续发送所有块 ...         |
     |──── 3. file_chunk [N-1] ──────────>|
     |                                    |
     |══════════════════════════════════════
     |                                    |
     |──── 4. file_end ──────────────────>|
     |      (所有块已发送)                 |
     |                                    |
     |<─── 5. file_complete ──────────────|
     |      (校验和验证结果)               |
```

> **v3 特性**: 数据块连续发送，无需等待每块确认。接收端在收到 `file_end` 后验证完整性，通过 `file_complete` 返回最终结果。

### 5.2 消息定义

#### 5.2.1 `file_start` - 开始传输

**方向：** Client → Server

```typescript
type LanTransferFileStartMessage = {
  type: "file_start";
  transferId: string; // UUID，唯一传输标识
  fileName: string; // 文件名（含扩展名）
  fileSize: number; // 文件总字节数
  mimeType: string; // MIME 类型
  checksum: string; // 整个文件的 SHA-256 哈希（hex）
  totalChunks: number; // 总数据块数
  chunkSize: number; // 每块大小（字节）
};
```

**示例：**

```json
{
  "type": "file_start",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "fileName": "backup.zip",
  "fileSize": 524288000,
  "mimeType": "application/zip",
  "checksum": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "totalChunks": 1000,
  "chunkSize": 524288
}
```

#### 5.2.2 `file_start_ack` - 传输确认

**方向：** Server → Client

```typescript
type LanTransferFileStartAckMessage = {
  type: "file_start_ack";
  transferId: string; // 对应的传输 ID
  accepted: boolean; // 是否接受传输
  message?: string; // 拒绝原因
};
```

**接受示例：**

```json
{
  "type": "file_start_ack",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "accepted": true
}
```

**拒绝示例：**

```json
{
  "type": "file_start_ack",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "accepted": false,
  "message": "Insufficient storage space"
}
```

#### 5.2.3 `file_chunk` - 数据块

**方向：** Client → Server（**二进制帧**，见 4.2）

- 不再使用 JSON/`\n`，也不再使用 Base64
- 帧结构：`Magic` + `TotalLen` + `Type` + `TransferId` + `ChunkIdx` + `Data`
- `Type` 固定 `0x01`，`Data` 为原始文件二进制数据
- 传输完整性依赖 `file_start.checksum`（全文件 SHA-256）；分块校验和可选，不在帧中发送

#### 5.2.4 `file_end` - 传输结束

**方向：** Client → Server

```typescript
type LanTransferFileEndMessage = {
  type: "file_end";
  transferId: string; // 传输 ID
};
```

**示例：**

```json
{
  "type": "file_end",
  "transferId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### 5.2.5 `file_complete` - 传输完成

**方向：** Server → Client

```typescript
type LanTransferFileCompleteMessage = {
  type: "file_complete";
  transferId: string; // 传输 ID
  success: boolean; // 是否成功
  filePath?: string; // 保存路径（成功时）
  error?: string; // 错误信息（失败时）
  // v3 新增字段
  errorCode?:
    | "CHECKSUM_MISMATCH"
    | "INCOMPLETE_TRANSFER"
    | "DISK_ERROR"
    | "CANCELLED";
  receivedChunks?: number; // 实际接收的数据块数量
  receivedBytes?: number; // 实际接收的字节数
};
```

**错误码说明：**

| 错误码                | 说明                       |
| --------------------- | -------------------------- |
| `CHECKSUM_MISMATCH`   | 校验和不匹配               |
| `INCOMPLETE_TRANSFER` | 传输不完整，缺少数据块     |
| `DISK_ERROR`          | 磁盘写入错误或存储空间不足 |
| `CANCELLED`           | 传输被取消                 |

**成功示例：**

```json
{
  "type": "file_complete",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "filePath": "/storage/emulated/0/Documents/backup.zip",
  "receivedChunks": 1000,
  "receivedBytes": 524288000
}
```

**失败示例：**

```json
{
  "type": "file_complete",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "success": false,
  "error": "File checksum verification failed",
  "errorCode": "CHECKSUM_MISMATCH",
  "receivedChunks": 1000,
  "receivedBytes": 524288000
}
```

#### 5.2.6 `file_cancel` - 取消传输

**方向：** Client → Server

```typescript
type LanTransferFileCancelMessage = {
  type: "file_cancel";
  transferId: string; // 传输 ID
  reason?: string; // 取消原因
};
```

**示例：**

```json
{
  "type": "file_cancel",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "reason": "Cancelled by user"
}
```

### 5.3 校验和算法

#### 整个文件校验和（保持不变）

```typescript
async function calculateFileChecksum(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}
```

#### 数据块校验和

v3 默认 **不传输分块校验和**，依赖最终文件 checksum。若需要，可在应用层自定义（非协议字段）。

### 5.4 校验流程

**发送端（Client）：**

1. 发送前计算整个文件的 SHA-256 → `file_start.checksum`
2. 分块直接发送原始二进制（无 Base64）

**接收端（Server）：**

1. 收到 `file_chunk` 后直接使用二进制数据
2. 边收边落盘并增量计算 SHA-256（推荐）
3. 所有块接收完成后，计算/完成增量哈希，得到最终 SHA-256
4. 与 `file_start.checksum` 比对，结果写入 `file_complete`

### 5.5 数据块大小计算

```typescript
const CHUNK_SIZE = 512 * 1024; // 512KB

const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

// 最后一个块可能小于 CHUNK_SIZE
const lastChunkSize = fileSize % CHUNK_SIZE || CHUNK_SIZE;
```

---

## 6. 心跳与连接保活

### 6.1 心跳消息

#### `ping`

**方向：** Client → Server

```typescript
type LanTransferPingMessage = {
  type: "ping";
  payload?: string; // 可选载荷
};
```

```json
{
  "type": "ping",
  "payload": "heartbeat"
}
```

#### `pong`

**方向：** Server → Client

```typescript
type LanTransferPongMessage = {
  type: "pong";
  received: boolean; // 确认收到
  payload?: string; // 回传 ping 的载荷
};
```

```json
{
  "type": "pong",
  "received": true,
  "payload": "heartbeat"
}
```

### 6.2 心跳策略

- 握手成功后立即发送一次 `ping` 验证连接
- 可选：定期发送心跳保持连接活跃
- `pong` 应返回 `ping` 中的 `payload`（可选）

---

## 7. 错误处理

### 7.1 超时配置

| 操作     | 超时时间 | 说明                 |
| -------- | -------- | -------------------- |
| TCP 连接 | 10 秒    | 连接建立超时         |
| 握手等待 | 10 秒    | 等待 `handshake_ack` |
| 传输完成 | 60 秒    | 等待 `file_complete` |
| 全局超时 | 10 分钟  | 整个文件传输超时     |

### 7.2 错误场景处理

| 场景         | Client 处理              | Server 处理                     |
| ------------ | ------------------------ | ------------------------------- |
| TCP 连接失败 | 通知 UI，允许重试        | -                               |
| 握手超时     | 断开连接，通知 UI        | 关闭 socket                     |
| 握手被拒绝   | 显示拒绝原因             | -                               |
| 用户取消     | 发送 `file_cancel`，清理 | 清理临时文件                    |
| 连接意外断开 | 清理状态，通知 UI        | 清理临时文件                    |
| 存储空间不足 | -                        | 发送 `accepted: false`          |
| 校验和失败   | 显示错误信息             | 发送 `file_complete` 带错误码   |
| 数据块缺失   | 显示错误信息             | 发送 `INCOMPLETE_TRANSFER` 错误 |

### 7.3 资源清理

**Client 端：**

```typescript
function cleanup(): void {
  // 1. 销毁文件读取流
  if (readStream) {
    readStream.destroy();
  }
  // 2. 清理传输状态
  activeTransfer = undefined;
  // 3. 关闭 socket（如需要）
  socket?.destroy();
}
```

**Server 端：**

```typescript
function cleanup(): void {
  // 1. 关闭文件写入流
  if (writeStream) {
    writeStream.end();
  }
  // 2. 删除未完成的临时文件
  if (tempFilePath) {
    fs.unlinkSync(tempFilePath);
  }
  // 3. 清理传输状态
  activeTransfer = undefined;
}
```

---

## 8. 常量与配置

### 8.1 协议常量

```typescript
// 协议版本（v3 = 控制 JSON + 二进制 chunk 流式传输）
export const LAN_TRANSFER_PROTOCOL_VERSION = "3";

// 服务发现
export const LAN_TRANSFER_SERVICE_TYPE = "cherrystudio";
export const LAN_TRANSFER_SERVICE_FULL_NAME = "_cherrystudio._tcp";

// TCP 端口
export const LAN_TRANSFER_TCP_PORT = 53317;

// 文件传输（与二进制帧一致）
export const LAN_TRANSFER_CHUNK_SIZE = 512 * 1024; // 512KB
export const LAN_TRANSFER_MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
export const LAN_TRANSFER_GLOBAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

// 注意：接收端必须支持至少 512KB 的分片大小，否则会拒收并返回类似
// "Chunk size 524288 exceeds limit 65536" 的错误。

// 超时设置
export const LAN_TRANSFER_HANDSHAKE_TIMEOUT_MS = 10_000; // 10秒
export const LAN_TRANSFER_COMPLETE_TIMEOUT_MS = 60_000; // 60秒
```

### 8.2 支持的文件类型

当前仅支持 ZIP 文件：

```typescript
export const LAN_TRANSFER_ALLOWED_EXTENSIONS = [".zip"];
export const LAN_TRANSFER_ALLOWED_MIME_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
];
```

---

## 9. 完整时序图

### 9.1 完整传输流程（v3，流式传输）

```
┌─────────┐                           ┌─────────┐                           ┌─────────┐
│ Renderer│                           │  Main   │                           │ Mobile  │
│  (UI)   │                           │ Process │                           │ Server  │
└────┬────┘                           └────┬────┘                           └────┬────┘
     │                                     │                                     │
     │  ════════════ 服务发现阶段 ════════════                                   │
     │                                     │                                     │
     │ startScan()                         │                                     │
     │────────────────────────────────────>│                                     │
     │                                     │ mDNS browse                         │
     │                                     │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─>│
     │                                     │                                     │
     │                                     │<─ ─ ─ service discovered ─ ─ ─ ─ ─ ─│
     │                                     │                                     │
     │<────── onServicesUpdated ───────────│                                     │
     │                                     │                                     │
     │  ════════════ 握手连接阶段 ════════════                                   │
     │                                     │                                     │
     │ connect(peer)                       │                                     │
     │────────────────────────────────────>│                                     │
     │                                     │──────── TCP Connect ───────────────>│
     │                                     │                                     │
     │                                     │──────── handshake (v=3) ───────────>│
     │                                     │                                     │
     │                                     │<─────── handshake_ack ──────────────│
     │                                     │                                     │
     │                                     │──────── ping ──────────────────────>│
     │                                     │<─────── pong ───────────────────────│
     │                                     │                                     │
     │<────── connect result ──────────────│                                     │
     │                                     │                                     │
     │  ════════════ 文件传输阶段 ════════════                                   │
     │                                     │                                     │
     │ sendFile(path)                      │                                     │
     │────────────────────────────────────>│                                     │
     │                                     │──────── file_start ────────────────>│
     │                                     │                                     │
     │                                     │<─────── file_start_ack ─────────────│
     │                                     │                                     │
     │                                     │══════ 连续发送数据块（无确认）═══════│
     │                                     │                                     │
     │                                     │──────── file_chunk[0] (binary) ────>│
     │                                     │──────── file_chunk[1] (binary) ────>│
     │                                     │──────── file_chunk[2] (binary) ────>│
     │<────── progress event ──────────────│         ... 连续发送 ...            │
     │                                     │──────── file_chunk[N-1] (binary) ──>│
     │                                     │                                     │
     │                                     │══════════════════════════════════════│
     │                                     │                                     │
     │                                     │──────── file_end ──────────────────>│
     │                                     │                                     │
     │                                     │      (接收端验证 checksum)          │
     │                                     │                                     │
     │                                     │<─────── file_complete ──────────────│
     │                                     │                                     │
     │<────── complete event ──────────────│                                     │
     │<────── sendFile result ─────────────│                                     │
     │                                     │                                     │
```

> **v3 特性**: 数据块连续发送，不等待单个确认，大幅提高传输速度。接收端在 `file_end` 后统一验证完整性。

---

## 10. 移动端实现指南（v3 要点）

### 10.1 必须实现的功能

1. **mDNS 服务发布**

   - 发布 `_cherrystudio._tcp` 服务
   - 提供 TCP 端口号 `53317`
   - 可选：TXT 记录（版本、平台信息）

2. **TCP 服务端**

   - 监听指定端口
   - 支持单连接或多连接

3. **消息解析**

   - 控制消息：UTF-8 + `\n` JSON
   - 数据消息：二进制帧（Magic+TotalLen 分帧）

4. **握手处理**

   - 验证 `handshake` 消息（version=3）
   - 发送 `handshake_ack` 响应
   - 响应 `ping` 消息

5. **文件接收（v3 流式模式）**

   - 解析 `file_start`，准备接收
   - 接收 `file_chunk` 二进制帧，直接写入文件并增量计算哈希
   - **无需发送 `file_chunk_ack`**（v3 移除了逐块确认）
   - 处理 `file_end`，完成增量哈希并校验 checksum
   - 发送 `file_complete` 结果（包含 errorCode、receivedChunks、receivedBytes）

6. **取消处理**
   - 监听 `file_cancel` 消息
   - 清理临时文件和状态

### 10.2 推荐的库

**React Native / Expo：**

- mDNS: `react-native-zeroconf` 或 `@homielab/react-native-bonjour`
- TCP: `react-native-tcp-socket`
- Crypto: `expo-crypto` 或 `react-native-quick-crypto`

### 10.3 接收端伪代码

```typescript
class FileReceiver {
  private transfer?: {
    id: string;
    fileName: string;
    fileSize: number;
    checksum: string;
    totalChunks: number;
    receivedChunks: number;
    tempPath: string;
    // v3: 边收边写文件，避免大文件 OOM
    // stream: FileSystem writable stream (平台相关封装)
  };

  handleMessage(message: any) {
    switch (message.type) {
      case "handshake":
        this.handleHandshake(message);
        break;
      case "ping":
        this.sendPong(message);
        break;
      case "file_start":
        this.handleFileStart(message);
        break;
      // v3: file_chunk 为二进制帧，不走 JSON 分支
      case "file_end":
        this.handleFileEnd(message);
        break;
      case "file_cancel":
        this.handleFileCancel(message);
        break;
    }
  }

  handleFileStart(msg: LanTransferFileStartMessage) {
    // 1. 检查存储空间
    // 2. 创建临时文件
    // 3. 初始化传输状态
    // 4. 发送 file_start_ack
  }

  // v3: 二进制帧处理在 socket data 流中解析，随后调用 handleBinaryFileChunk
  handleBinaryFileChunk(transferId: string, chunkIndex: number, data: Buffer) {
    // 直接使用二进制数据，按 chunkSize/lastChunk 计算长度
    // 写入文件流并更新增量 SHA-256
    this.transfer.receivedChunks++;
    // v3: 无需发送 file_chunk_ack，连续接收数据块即可
  }

  handleFileEnd(msg: LanTransferFileEndMessage) {
    // 1. 合并所有数据块
    // 2. 验证完整文件 checksum
    // 3. 写入最终位置
    // 4. 发送 file_complete
  }
}
```

---

## 附录 A：TypeScript 类型定义

完整的类型定义位于 `src/types/lanTransfer.ts`：

```typescript
// 握手消息
export interface LanTransferHandshakeMessage {
  type: "handshake";
  deviceName: string;
  version: string;
  platform?: string;
  appVersion?: string;
}

export interface LanTransferHandshakeAckMessage {
  type: "handshake_ack";
  accepted: boolean;
  message?: string;
}

// 心跳消息
export interface LanTransferPingMessage {
  type: "ping";
  payload?: string;
}

export interface LanTransferPongMessage {
  type: "pong";
  received: boolean;
  payload?: string;
}

// 文件传输消息 (Client -> Server)
export interface LanTransferFileStartMessage {
  type: "file_start";
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksum: string;
  totalChunks: number;
  chunkSize: number;
}

// v3: file_chunk 以二进制帧传输，不是 JSON 消息
// 帧格式: Magic(2B) + TotalLen(4B) + Type(1B, 0x01) + TransferIdLen(2B) + TransferId(nB) + ChunkIndex(4B) + Data
export interface LanTransferFileChunkBinaryFrame {
  type: 0x01; // 二进制帧类型标识 (file_chunk)
  transferId: string;
  chunkIndex: number;
  data: Buffer; // 原始二进制数据
}

export interface LanTransferFileEndMessage {
  type: "file_end";
  transferId: string;
}

export interface LanTransferFileCancelMessage {
  type: "file_cancel";
  transferId: string;
  reason?: string;
}

// 文件传输响应消息 (Server -> Client)
export interface LanTransferFileStartAckMessage {
  type: "file_start_ack";
  transferId: string;
  accepted: boolean;
  message?: string;
}

// v3: 移除了 LanTransferFileChunkAckMessage（流式传输无需逐块确认）

export interface LanTransferFileCompleteMessage {
  type: "file_complete";
  transferId: string;
  success: boolean;
  filePath?: string;
  error?: string;
  // v3 新增字段
  errorCode?:
    | "CHECKSUM_MISMATCH"
    | "INCOMPLETE_TRANSFER"
    | "DISK_ERROR"
    | "CANCELLED";
  receivedChunks?: number;
  receivedBytes?: number;
}

// 常量
export const LAN_TRANSFER_PROTOCOL_VERSION = "3";
export const LAN_TRANSFER_TCP_PORT = 53317;
export const LAN_TRANSFER_CHUNK_SIZE = 512 * 1024;
export const LAN_TRANSFER_MAX_FILE_SIZE = 500 * 1024 * 1024;
// v3: 移除了 CHUNK_TIMEOUT_MS（流式传输无需逐块等待超时）
```

---

## 附录 B：版本历史

| 版本 | 日期    | 变更                                                               |
| ---- | ------- | ------------------------------------------------------------------ |
| 1.0  | 2025-12 | 初始版本，与移动端实现对齐                                         |
| 2.0  | 2025-12 | 引入二进制帧格式传输数据块，仍使用逐块 ACK 确认                    |
| 3.0  | 2025-12 | 流式传输模式，移除 `file_chunk_ack`，增强 `file_complete` 错误诊断 |
