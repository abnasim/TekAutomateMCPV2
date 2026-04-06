import { existsSync } from 'fs';
import * as path from 'path';

function hasRepoMarkers(dir: string): boolean {
  return (
    existsSync(path.join(dir, 'public', 'commands')) &&
    existsSync(path.join(dir, 'mcp-server'))
  );
}

export function resolveRepoRoot(): string {
  const cwd = process.cwd();
  if (hasRepoMarkers(cwd)) return cwd;

  const parent = path.resolve(cwd, '..');
  if (hasRepoMarkers(parent)) return parent;

  return cwd;
}

export function resolveCommandsDir(): string {
  return path.join(resolveRepoRoot(), 'public', 'commands');
}

export function resolveRagDir(): string {
  return path.join(resolveRepoRoot(), 'public', 'rag');
}

export function resolveTemplatesDir(): string {
  return path.join(resolveRepoRoot(), 'public', 'templates');
}

export function resolvePoliciesDir(): string {
  const repoRoot = resolveRepoRoot();
  const inRepo = path.join(repoRoot, 'mcp-server', 'policies');
  if (existsSync(inRepo)) return inRepo;
  return path.join(process.cwd(), 'policies');
}

export function resolveProvidersDir(customDir?: string): string {
  const candidate = String(customDir || '').trim();
  if (candidate) return path.resolve(process.cwd(), candidate);

  const repoRoot = resolveRepoRoot();
  const inRepo = path.join(repoRoot, 'mcp-server', 'providers');
  if (existsSync(inRepo)) return inRepo;

  const local = path.join(process.cwd(), 'providers');
  if (existsSync(local)) return local;

  return inRepo;
}
