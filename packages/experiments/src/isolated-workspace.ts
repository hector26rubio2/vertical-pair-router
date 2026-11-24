import {mkdir, cp, realpath, readdir, lstat} from 'node:fs/promises';
import {resolve, relative, isAbsolute, dirname, basename, join} from 'node:path';
import {createHash} from 'node:crypto';

async function canonicalTarget(path: string): Promise<string> {
  let cursor = resolve(path); const missing: string[] = [];
  for (;;) {
    try {return resolve(await realpath(cursor), ...missing.reverse());}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(cursor) === cursor) throw error;
      missing.push(basename(cursor)); cursor = dirname(cursor);
    }
  }
}
function inside(root: string, candidate: string) {
  const path = relative(root, candidate).replaceAll('\\', '/');
  return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith('../');
}
export function createIsolatedWorkspaceFactory(frozenRoot: string, isolatedRoot: string) {
  const cells = new Map<string, Promise<string>>();
  return async (input: {readonly cellId: string}) => {
    const previous = cells.get(input.cellId); if (previous) return previous;
    const pending = (async () => {
      const source = await realpath(frozenRoot), target = await canonicalTarget(isolatedRoot);
      if (inside(source, target) || inside(target, source)) throw new Error('Isolated and frozen roots overlap');
      await mkdir(target, {recursive: true});
      const path = join(target, 'cell-' + createHash('sha256').update(input.cellId).digest('hex').slice(0, 24));
      // Refuse pre-existing directories; a new campaign must not reuse modified workspaces.
      await mkdir(path);
      for (const entry of await readdir(source)) await cp(join(source, entry), join(path, entry), {recursive: true, dereference: false, errorOnExist: true, force: false,
        filter: async file => {
          const local = relative(source, file).replaceAll('\\', '/'), parts = local.toLowerCase().split('/'), name = parts.at(-1) ?? '';
          if (!local) return true;
          const metadata = await lstat(file);
          if (metadata.isSymbolicLink()) return false;
          if (parts.some(p => ['.git', '.tmp', 'dist', 'node_modules', '.vpr', 'coverage', 'logs', 'credentials'].includes(p))) return false;
          return !/^(?:appsettings(?:[._-].*)?|\.env(?:\..*)?|\.envrc|\.npmrc|\.pypirc|credentials(?:\..*)?|id_rsa|id_ed25519)$/iu.test(name)
            && !/\.(?:pfx|p12|pem|key|sqlite|sqlite3|db)$/iu.test(name);
        }});
      return path;
    })();
    cells.set(input.cellId, pending); return pending;
  };
}
