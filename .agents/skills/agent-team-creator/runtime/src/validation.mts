import { harnesses, type Team, type Json, type ObjectValue, type Target } from './types.mjs';

export function object(value: unknown, label = 'input'): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object`);
  return value as ObjectValue;
}
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${label} must be a nonempty string`);
  return value;
}
export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) throw Error(`${label} must be a string array`);
  return value as string[];
}
export function id(value: unknown, label = 'id'): string {
  const result = text(value, label);
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(result) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(result)) throw Error(`${label} must be a portable lowercase identifier`);
  return result;
}
export function target(value: unknown): Target {
  if (typeof value !== 'string' || ![...harnesses, 'bossfang'].includes(value as Target)) throw Error('Unknown harness target');
  return value as Target;
}
export function policy(value: unknown, label: string): void {
  const p = object(value, label);
  for (const key of Object.keys(p)) if (!['model', 'tier', 'capabilities', 'maxInputPerMillion', 'maxOutputPerMillion'].includes(key)) throw Error(`Unknown ${label} field: ${key}`);
  if (p.model !== undefined) text(p.model, `${label}.model`);
  if (p.tier !== undefined && !['low', 'medium', 'hard'].includes(String(p.tier))) throw Error(`Invalid ${label}.tier`);
  if (p.capabilities !== undefined) strings(p.capabilities, `${label}.capabilities`);
  for (const key of ['maxInputPerMillion', 'maxOutputPerMillion']) {
    if (p[key] !== undefined && (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < 0)) throw Error(`Invalid ${label}.${key}`);
  }
}
export function relativeFile(file: string): string {
  if (!file || file.includes('\\') || file.startsWith('/') || /[<>:"|?*\u0000-\u001f]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p))) throw Error(`Unsafe portable file path: ${file}`);
  return file;
}
export function validateTeam(value: unknown): Team {
  const t = object(value, 'team');
  const allowed = ['schemaVersion','id','outcome','scope','harness','roles','modelPolicy','skillPolicies','native'];
  for (const key of Object.keys(t)) if (!allowed.includes(key)) throw Error(`Unknown team field ${key}; use native.<target>.options or files for harness-specific configuration`);
  if (t.schemaVersion !== 1) throw Error('team.schemaVersion must be 1');
  id(t.id, 'team.id'); text(t.outcome, 'team.outcome');
  if (!['project', 'uar', 'bossfang'].includes(String(t.scope))) throw Error('Invalid scope');
  if (!harnesses.includes(t.harness as typeof harnesses[number])) throw Error('Invalid team.harness');
  if (!Array.isArray(t.roles) || t.roles.length === 0) throw Error('At least one role is required');
  const ids = new Set<string>();
  for (const entry of t.roles) {
    const r = object(entry, 'role'), key = id(r.id, 'role.id');
    if (ids.has(key)) throw Error(`Duplicate role ${key}`); ids.add(key);
    for (const field of Object.keys(r)) if (!['id','description','prompt','skills','owns','inputs','outputs','dependsOn','modelPolicy','native'].includes(field)) throw Error(`Unknown role field ${field}`);
    text(r.description, 'description'); text(r.prompt, 'prompt');
    for (const field of ['skills','owns','inputs','outputs','dependsOn']) strings(r[field], field);
    if (r.modelPolicy !== undefined) policy(r.modelPolicy, 'role.modelPolicy');
    if (r.native !== undefined) for (const [key, v] of Object.entries(object(r.native))) { target(key); object(v, `role.native.${key}`); }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const team = t as unknown as Team;
  function visit(key: string): void {
    if (visiting.has(key)) throw Error('Role dependency cycle');
    if (visited.has(key)) return;
    const r = team.roles.find(r => r.id === key);
    if (!r) throw Error(`Unknown dependency ${key}`);
    visiting.add(key); r.dependsOn.forEach(visit); visiting.delete(key); visited.add(key);
  }
  ids.forEach(visit);
  if (t.modelPolicy !== undefined) policy(t.modelPolicy, 'modelPolicy');
  if (t.skillPolicies !== undefined) for (const [key, v] of Object.entries(object(t.skillPolicies))) policy(v, `skillPolicies.${key}`);
  if (t.native !== undefined) for (const [key, v] of Object.entries(object(t.native))) {
    target(key); const n = object(v, `native.${key}`);
    for (const field of Object.keys(n)) if (!['version','source','options','files'].includes(field)) throw Error(`Unknown native wrapper field ${field}; put native settings in options or files`);
    text(n.version, 'native version'); text(n.source, 'native source');
    if (n.options !== undefined) object(n.options, 'native options');
    if (n.files !== undefined) for (const [file, content] of Object.entries(object(n.files))) {
      relativeFile(file); if (typeof content !== 'string') throw Error('Native file content must be a string');
    }
  }
  return structuredClone(team);
}

export const asJson = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
