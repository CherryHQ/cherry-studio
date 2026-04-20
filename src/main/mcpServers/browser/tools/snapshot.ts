import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

export const SnapshotSchema = z.object({
  selector: z
    .string()
    .optional()
    .describe('CSS selector to scope the snapshot (e.g. "#search" for search results only)'),
  maxChars: z.number().optional().describe('Maximum characters to return (truncates with notice if exceeded)'),
  privateMode: z.boolean().optional().describe('Target private session (default: false)'),
  tabId: z.string().optional().describe('Target specific tab by ID')
})

// Script that walks the DOM and produces an AI-friendly text snapshot with numbered refs for interactive elements
const SNAPSHOT_SCRIPT = `(() => {
  const out = [];
  let n = 0;
  const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','PATH','META','LINK','BR','HR']);

  function vis(e) {
    if (!e.getBoundingClientRect) return false;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  function walk(node) {
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (t) out.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    if (skip.has(node.tagName)) return;
    if (!vis(node)) return;

    const tag = node.tagName;
    const r = ++n;

    if (tag === 'A' && node.href) {
      const t = node.textContent.trim();
      if (t) out.push('[' + r + '] link: ' + t + ' (' + node.href + ')');
      return;
    }
    if (tag === 'BUTTON' || (tag === 'INPUT' && (node.type === 'submit' || node.type === 'button'))) {
      out.push('[' + r + '] button: ' + (node.textContent.trim() || node.value || ''));
      return;
    }
    if (tag === 'INPUT') {
      if (node.type === 'hidden') return;
      out.push('[' + r + '] input(' + (node.type || 'text') + '): ' + (node.name || node.placeholder || ''));
      return;
    }
    if (tag === 'TEXTAREA') {
      out.push('[' + r + '] textarea: ' + (node.name || node.placeholder || ''));
      return;
    }
    if (tag === 'SELECT') {
      const sel = node.options && node.options[node.selectedIndex];
      out.push('[' + r + '] select: ' + (sel ? sel.text : node.name || ''));
      return;
    }
    if (tag === 'IMG' && node.alt) {
      out.push('[' + r + '] img: ' + node.alt);
      return;
    }
    if (/^H[1-6]$/.test(tag)) {
      const level = tag[1];
      out.push('\\n' + '#'.repeat(+level) + ' ' + node.textContent.trim() + '\\n');
      return;
    }

    for (const c of node.childNodes) walk(c);
  }

  walk(ROOT_ELEMENT);
  return out.join('\\n');
})()`

export const snapshotToolDefinition = {
  name: 'snapshot',
  description:
    'Get an AI-friendly text snapshot of the current page with numbered refs for interactive elements. Much more compact than raw HTML/markdown. Use selector to scope to a specific part (e.g. "#search" for Google results, "#main" for article body). PARALLEL: Can be called simultaneously on different tabs.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to scope the snapshot (e.g. "#search", "#main", ".results")'
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters to return (default: unlimited)'
      },
      privateMode: {
        type: 'boolean',
        description: 'Target private session (default: false)'
      },
      tabId: {
        type: 'string',
        description: 'Target specific tab by ID'
      }
    }
  }
}

export async function handleSnapshot(controller: CdpBrowserController, args: unknown) {
  try {
    const { selector, maxChars, privateMode, tabId } = SnapshotSchema.parse(args)

    const rootExpr = selector
      ? `(document.querySelector(${JSON.stringify(selector)}) || document.body)`
      : 'document.body'

    const script = SNAPSHOT_SCRIPT.replace('ROOT_ELEMENT', rootExpr)

    const result = await controller.execute(script, 10000, privateMode ?? false, tabId)

    let content = typeof result === 'string' ? result : (JSON.stringify(result) ?? '')
    if (maxChars && content.length > maxChars) {
      content = content.slice(0, maxChars) + '\n... [truncated at ' + maxChars + ' chars]'
    }

    return successResponse(content)
  } catch (error) {
    logger.error('Snapshot failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
