type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const escape = (v: unknown) => String(v ?? 'N/D').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const display = (v: unknown) => numeric(v) === null ? 'N/D' : Number(v).toLocaleString('es-CO', {maximumFractionDigits: 8});
const money = (v: unknown) => {const p = object(v); return numeric(p.min) === null || numeric(p.max) === null
  ? 'N/D' : display(p.min) + (p.min === p.max ? '' : '–' + display(p.max));};
const sum = (rows: readonly Json[], key: string) => rows.length && rows.every(r => numeric(r[key]) !== null)
  ? rows.reduce((s, r) => s + Number(r[key]), 0) : null;
function breakdown(row: Json): Json[] {
  const models = list(row.models).map(object);
  const phases = list(row.phaseCosts).flatMap(item => {
    const p = object(item); return list(p.models).map(m => ({...object(m), role: p.phase,
      wallMs: object(object(p.receipt).timings).wallMs}));
  });
  return phases.length && ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
    .every(key => sum(phases, key) !== null && sum(phases, key) === sum(models, key)) ? phases : models;
}
export function renderScenarioDetails(value: unknown) {
  const report = object(value), tasks = list(report.tasks).map(object);
  const body = list(report.rows).map(item => {
    const row = object(item), task = tasks.find(t => t.id === row.taskId) ?? {}, models = breakdown(row), span = Math.max(1, models.length) + 1;
    const counters = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'];
    const parts = ['inputUsd', 'outputUsd', 'cacheReadUsd', 'cacheWriteUsd'];
    const taskCells = '<th rowspan="' + span + '">' + escape(row.taskId) + ' · ' + escape(task.name) + '<p>' + escape(task.level)
      + '</p><details><summary>Tarea exacta y alcance</summary>' + escape(task.requirement) + '</details></th>'
      + '<td rowspan="' + span + '">' + escape(row.arm) + '<p>Protocolo: ' + escape(row.protocol ?? task.protocol)
      + '</p><p>Estado observado: ' + escape(row.status) + '</p></td>';
    const lines = models.map((m, i) => '<tr>' + (i === 0 ? taskCells : '') + '<th>' + escape(m.model) + '<small>'
      + escape(m.role) + '</small>' + (m.provider === 'codex' ? '<small>Identidad solicitada; precio condicional</small>' : '') + '</th>'
      + counters.map((key, j) => '<td>' + display(m[key]) + (j < 4 ? '<small>USD ' + money(object(m.cost)[parts[j]!]) + '</small>' : '') + '</td>').join('')
      + '<td>' + display(m.maxObservedPromptTokens) + '</td><td>' + (numeric(m.wallMs) === null ? 'N/D' : display(Number(m.wallMs) / 1000) + ' s')
      + '</td><td>USD ' + money(object(m.cost).totalUsd) + '</td></tr>').join('');
    const total = '<tr class="total"><th>SUMA DE ESTA EJECUCIÓN</th>'
      + counters.map(key => '<td>' + models.map(m => display(m[key])).join(' + ') + ' = <b>' + display(sum(models, key)) + '</b></td>').join('')
      + '<td>N/D si faltan llamadas</td><td>Agentes: ' + display(numeric(object(object(row.receipt).timings).wallMs) === null
        ? null : Number(object(object(row.receipt).timings).wallMs) / 1000) + ' s; checks: '
      + display(numeric(row.localChecksTotalMs) === null ? null : Number(row.localChecksTotalMs) / 1000) + ' s</td><td>'
      + models.map(m => money(object(m.cost).totalUsd)).join(' + ') + ' = <b>USD '
      + money(row.completeModelAccounting === false ? null : row.totalCost) + '</b></td></tr>';
    return lines + (!models.length ? '<tr>' + taskCells + '<td colspan="9">N/D: no se recibió desglose por modelo; no es costo cero.</td></tr>' : '') + total;
  }).join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>VPR · Escenarios y modelos</title><style>
body{font:14px system-ui;margin:20px;color:#172033}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #d8e0e8;text-align:left}
thead,.total{background:#e9f3f7}small{display:block;font-size:12px;margin-top:5px}details{max-width:450px}p{max-width:450px}.scroll{overflow:auto}
</style><h1>Tarea, escenario y consumo de cada modelo</h1><p><a href="../informe.html">Volver al análisis</a></p>
<p>Cada bloque contiene una ejecución y la suma de sus modelos. Entrada es sin caché; total = entrada + salida + caché leída + escrita.
Los USD son referencia API, no cobro ni cuota de suscripción. Un precio bajo no demuestra calidad. No se suman otra vez los totales del recibo.</p>
<div class="scroll"><table><thead><tr><th>Tarea y nivel</th><th>Escenario / combinación</th><th>Modelo · fase</th>
<th>Entrada sin caché · tokens / USD</th><th>Salida · tokens / USD</th><th>Caché leída · tokens / USD</th>
<th>Caché escrita · tokens / USD</th><th>Total tokens</th><th>Contexto máximo observado</th><th>Tiempo observado</th><th>Costo / suma USD</th>
</tr></thead><tbody>${body}</tbody></table></div></html>`;
}
