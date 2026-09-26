import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ExportResult } from './types.mjs';
import { relativeFile } from './validation.mjs';

/** An export is a new proposal directory, never an in-place config merge. */
export function writeExport(out: string, result: ExportResult): { directory: string; files: string[] } {
  const files = { ...result.files };
  const reserved = 'team-export.json';
  if (Object.keys(files).some(f => f.toLowerCase() === reserved)) throw Error(`Reserved export receipt path: ${reserved}`);
  const names = new Set<string>();
  for (const file of Object.keys(files)) {
    relativeFile(file);
    const lower = file.toLowerCase();
    if (names.has(lower)) throw Error(`Case-insensitive file collision: ${file}`);
    names.add(lower);
  }
  for (const file of names) for (const other of names) if (file !== other && other.startsWith(file + '/')) throw Error(`File/directory collision: ${file}`);
  files[reserved] = JSON.stringify({ target: result.target, verification: result.verification, diagnostics: result.diagnostics,
    instructions: result.instructions, files: Object.entries(files).map(([file, content]) => ({ file, sha256: createHash('sha256').update(content).digest('hex') })) }, null, 2) + '\n';
  const directory = path.resolve(out);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  // Nonrecursive mkdir is the no-overwrite boundary. A partial failed export remains
  // inspectable and cannot be mistaken for success (receipt is written last).
  fs.mkdirSync(directory);
  for (const [file, content] of Object.entries(files)) {
    const destination = path.join(directory, ...file.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, { flag: 'wx', mode: 0o600 });
  }
  return { directory, files: Object.keys(files) };
}
