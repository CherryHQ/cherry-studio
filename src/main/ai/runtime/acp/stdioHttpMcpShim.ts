const SHIM_SOURCE = `
const { createInterface } = require('node:readline');
const url = process.env.CHERRY_MCP_URL;
const token = process.env.CHERRY_MCP_TOKEN;
if (!url || !token) process.exit(1);

let sessionId;
let protocolVersion;
const writeLine = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const writeJsonText = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    writeLine(JSON.parse(trimmed));
  } catch {
    process.stdout.write(trimmed + '\\n');
  }
};

const flushSse = async (body) => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventData = [];
  const emitEvent = () => {
    if (!eventData.length) return;
    const payload = eventData.join('\\n').trim();
    eventData = [];
    if (payload) writeJsonText(payload);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') emitEvent();
      else if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\\r?\\n/)) {
    if (line === '') emitEvent();
    else if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
  }
  emitEvent();
};

const handleLine = async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (parsed && parsed.method === 'initialize' && parsed.params && typeof parsed.params.protocolVersion === 'string') {
    protocolVersion = parsed.params.protocolVersion;
  }
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (sessionId) headers['MCP-Session-Id'] = sessionId;
  if (protocolVersion && parsed.method !== 'initialize') headers['MCP-Protocol-Version'] = protocolVersion;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: trimmed });
    const nextSessionId = res.headers.get('mcp-session-id');
    if (nextSessionId) sessionId = nextSessionId;
    if (!res.ok) {
      if (parsed && parsed.id !== undefined) {
        writeLine({ jsonrpc: '2.0', id: parsed.id, error: { code: -32000, message: 'MCP HTTP ' + res.status } });
      }
      return;
    }
    if (res.status === 202 || res.status === 204) return;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      await flushSse(res.body);
    } else {
      writeJsonText(await res.text());
    }
  } catch (err) {
    if (parsed && parsed.id !== undefined) {
      writeLine({ jsonrpc: '2.0', id: parsed.id, error: { code: -32000, message: err && err.message ? err.message : String(err) } });
    }
  }
};

let queue = Promise.resolve();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  queue = queue.then(() => handleLine(line));
});
rl.on('close', () => {
  queue.finally(() => process.exit(0));
});
`.trim()

export interface StdioHttpMcpShimConfig {
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

/** Build an ACP stdio MCP server config relaying JSON-RPC to the loopback bridge without exposing tokens in argv. */
export function buildStdioHttpMcpShimConfig(url: string, token: string): StdioHttpMcpShimConfig {
  return {
    command: process.execPath,
    args: ['-e', SHIM_SOURCE],
    env: [
      { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
      { name: 'CHERRY_MCP_URL', value: url },
      { name: 'CHERRY_MCP_TOKEN', value: token }
    ]
  }
}
