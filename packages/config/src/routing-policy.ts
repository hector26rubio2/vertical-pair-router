import {readFile} from 'node:fs/promises';
import {parseDocument} from 'yaml';
import {validateRoutingPolicy, type RoutingPolicy} from '@vpr/contracts';

/** Bounded local parse; YAML cannot contain executable tags or expand aliases. */
export async function loadRoutingPolicy(path: string): Promise<RoutingPolicy> {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 65_536) throw new Error('Routing policy exceeds 64 KiB');
  const document = parseDocument(raw, {uniqueKeys: true, version: '1.2'});
  if (document.errors.length || document.warnings.length) throw new TypeError('Invalid routing policy YAML');
  const value: unknown = document.toJS({maxAliasCount: 0});
  const result = validateRoutingPolicy(value);
  if (!result.valid || !result.value) throw new TypeError('Invalid routing policy: ' + result.errors.join('; '));
  return result.value;
}
