import type {EvidenceOperation} from '@vpr/contracts';
import type {NativeSessionSnapshot} from './native-session-types.js';

export function inferOperation(input: {readonly phase?: string; readonly tools?: readonly string[]}): EvidenceOperation {
  const operations = new Set<EvidenceOperation>();
  for (const tool of input.tools ?? []) {
    if (/graphify/iu.test(tool)) operations.add('explorar_grafo');
    else if (/^(Grep|Glob|Search)$/iu.test(tool)) operations.add('buscar_codigo');
    else if (/^Read$/iu.test(tool)) operations.add('leer_archivo');
    else if (/^(Write|Edit|MultiEdit)$/iu.test(tool)) operations.add('implementar');
    else operations.add('desconocida');
  }
  if (operations.size) return operations.size === 1 ? [...operations][0]! : 'desconocida';
  const phases: Record<string, EvidenceOperation> = {
    triage: 'triar', plan: 'disenar', design: 'disenar', architecture: 'disenar',
    'technical-plan': 'disenar', stories: 'crear_historias', implement: 'implementar',
    repair: 'corregir', review: 'revisar', test: 'escribir_tests',
  };
  return phases[input.phase ?? ''] ?? 'desconocida';
}
/** Call metadata only. Operation is unknown when tool operations compete. No text is retained. */
export function labelNativeSnapshot(snapshot: NativeSessionSnapshot, phase?: string) {
  return snapshot.requests.map(request => {
    const tools = snapshot.tools.filter(tool => tool.requestId === request.id
      && tool.parentToolUseId === request.parentToolUseId);
    const count = (names: readonly string[]) => new Set(tools.filter(tool => names.includes(tool.name))
      .flatMap(tool => tool.pathHash ? [tool.pathHash] : [])).size;
    const reads = tools.filter(tool => tool.name === 'Read');
    return {...request, operation: inferOperation({...phase ? {phase} : {}, tools: tools.map(tool => tool.name)}),
      contextMax: request.cacheWriteReported === false ? null
        : request.inputTokens + request.cacheReadTokens + request.cacheWriteTokens,
      cacheHitRatio: request.cacheWriteReported !== false && request.inputTokens + request.cacheReadTokens + request.cacheWriteTokens > 0
        ? request.cacheReadTokens / (request.inputTokens + request.cacheReadTokens + request.cacheWriteTokens) : null,
      readCount: reads.every(tool => tool.pathHash) ? count(['Read']) : null,
      writtenCount: tools.filter(tool => ['Write', 'Edit', 'MultiEdit'].includes(tool.name)).every(tool => tool.pathHash)
        ? count(['Write', 'Edit', 'MultiEdit']) : null,
      readBytes: reads.length && reads.every(tool => tool.returnedTextBytes !== null && tool.returnedTextBytes !== undefined)
        ? reads.reduce((sum, tool) => sum + tool.returnedTextBytes!, 0) : null,
      readTokens: null, writtenBytes: null,
      byteBasis: 'returned tool text; not whole source file size',
      unavailable: {readTokens: 'Provider does not attribute tokens to files',
        writtenBytes: 'Edit payload does not establish whole-file bytes written'},
    };
  });
}
