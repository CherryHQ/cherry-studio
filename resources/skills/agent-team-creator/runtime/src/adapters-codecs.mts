import type { Json, ObjectValue, Role, Team } from './types.mjs';

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const object = (value: Json | undefined): value is ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Arrays replace; objects merge recursively; own keys (including __proto__) survive. */
export function merge(base: ObjectValue, override: ObjectValue = {}): ObjectValue {
  const result: ObjectValue = Object.create(null) as ObjectValue;
  for (const [key, value] of Object.entries(base)) result[key] = value;
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key];
    result[key] = object(previous) && object(value) ? merge(previous, value) : value;
  }
  return result;
}

function tomlValue(value: Json): string {
  if (value === null) throw new Error('TOML has no null value; omit the field or use an opaque native file.');
  if (typeof value === 'string') return JSON.stringify(value).replace(/\u007f/g, '\\u007f');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Native TOML requires finite JSON numbers.');
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  return `{ ${Object.entries(value).map(([key, item]) => `${tomlValue(key)} = ${tomlValue(item)}`).join(', ')} }`;
}

/** Quoted keys and inline tables preserve arbitrary native nesting without interpolation. */
export function toml(value: ObjectValue): string {
  return `${Object.entries(value).map(([key, item]) => `${tomlValue(key)} = ${tomlValue(item)}`).join('\n')}\n`;
}

/** JSON flow syntax is a YAML 1.2 subset, including escaped multiline strings. */
export const yaml = (value: unknown): string => json(value);
export const markdown = (frontmatter: ObjectValue, body: string): string =>
  `---\n${yaml(frontmatter)}---\n\n${body}\n`;

export function identifier(value: unknown, context: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,127}$/.test(value)) {
    throw new Error(`${context} must be a lowercase kebab-case identifier (1–128 characters).`);
  }
  return value;
}

export function model(team: Team, role: Role): string | undefined {
  return role.modelPolicy?.model ?? team.modelPolicy?.model;
}

export function prompt(team: Team, role: Role): string {
  return `${role.prompt}\n\nTeam outcome: ${team.outcome}\nRole: ${role.id}\n` +
    `Owns: ${JSON.stringify(role.owns)}\nInputs: ${JSON.stringify(role.inputs)}\n` +
    `Outputs: ${JSON.stringify(role.outputs)}\nDependencies: ${JSON.stringify(role.dependsOn)}\n` +
    `Requested skills: ${JSON.stringify(role.skills)}\n` +
    'Ownership and skill names are coordination instructions; native permissions and installed skills remain authoritative.';
}

export interface ExportContext {
  add(path: string, content: string): void;
  claimName(name: unknown): string;
  diagnostics: string[];
  instructions: string[];
}
