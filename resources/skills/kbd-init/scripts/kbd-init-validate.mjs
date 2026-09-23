#!/usr/bin/env node

import { constants, accessSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const projectRoot = resolve(process.argv[2] ?? process.cwd());
const projectPath = join(projectRoot, '.kbd-orchestrator', 'project.json');
const constraintsPath = join(projectRoot, '.kbd-orchestrator', 'constraints.md');

function fail(message) {
  console.error(`[kbd-init] configuration invalid: ${message}`);
  process.exit(1);
}

function loadProject() {
  if (!existsSync(projectPath)) fail(`missing ${projectPath}`);
  try {
    return JSON.parse(readFileSync(projectPath, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${projectPath}: ${error.message}`);
  }
}

function loadConstraints() {
  if (!existsSync(constraintsPath)) fail(`missing ${constraintsPath}`);
  return readFileSync(constraintsPath, 'utf8');
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function constraintCommands(markdown) {
  const commands = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:command|target):\s*(.+?)\s*$/);
    if (match) commands.push(unquote(match[1]));
  }
  return commands;
}

const cargoCompile = /\bcargo\s+(?:build|check|test|clippy|bench|doc|install|package)\b/;
const targetAssignment = /(?:^|\s)CARGO_TARGET_DIR=(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/;

function commandSegments(command) {
  return command.split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
}

function targetValues(command) {
  const values = [];
  for (const segment of commandSegments(command)) {
    if (!cargoCompile.test(segment)) continue;
    const assignment = segment.match(targetAssignment);
    values.push({ segment, value: assignment?.[1] ?? assignment?.[2] ?? assignment?.[3] });
  }
  return values;
}

function externalRoot(target) {
  const normalized = resolve(target);
  const parts = normalized.split('/').filter(Boolean);
  if (parts[0] === 'Volumes' && parts[1]) return `/Volumes/${parts[1]}`;
  if ((parts[0] === 'mnt' || parts[0] === 'media') && parts[1]) {
    return `/${parts[0]}/${parts[1]}`;
  }
  if (parts[0] === 'run' && parts[1] === 'media' && parts[2]) {
    return `/run/media/${parts[2]}`;
  }
  return null;
}

const project = loadProject();
const constraints = loadConstraints();
const projectCommands = [
  project.build_health_command,
  project.test_command,
  project.lint_command,
  project.dev_command,
].filter(value => typeof value === 'string' && value.trim());
const allCommands = [...projectCommands, ...constraintCommands(constraints)];
const compilingSegments = allCommands.flatMap(targetValues);
const configuredTargets = new Set(compilingSegments.map(item => item.value).filter(Boolean));

if (configuredTargets.size > 1) {
  fail(`compiling commands use inconsistent CARGO_TARGET_DIR values: ${[...configuredTargets].join(', ')}`);
}

if (configuredTargets.size === 1) {
  const [requiredTarget] = configuredTargets;
  for (const { segment, value } of compilingSegments) {
    if (!value) fail(`mandatory CARGO_TARGET_DIR is missing from command segment: ${segment}`);
    if (value !== requiredTarget) {
      fail(`command segment does not use ${requiredTarget}: ${segment}`);
    }
  }

  const requiredRoot = externalRoot(requiredTarget);
  if (requiredRoot) {
    try {
      accessSync(requiredRoot, constants.W_OK);
    } catch {
      console.warn(
        `[kbd-init] initialization complete; execution blocked: required path unavailable: ${requiredRoot}`
      );
      process.exit(0);
    }
  }
}

console.log('[kbd-init] configuration valid; execution prerequisites ready');
