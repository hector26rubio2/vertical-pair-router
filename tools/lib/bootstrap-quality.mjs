import {readFile} from 'node:fs/promises';
// CI checks staged secrets before installing dependencies. Resolve only the package's declared public bootstrap export.
const root = new URL('../../packages/quality/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const entry = manifest.exports?.['./staged-security'];
if (typeof entry !== 'string' || !entry.startsWith('./') || entry.includes('..')) throw new Error('Invalid quality bootstrap export');
const api = await import(new URL(entry, root).href);
export const checkStagedSecurity = api.checkStagedSecurity;
export const securityMain = api.securityMain;
