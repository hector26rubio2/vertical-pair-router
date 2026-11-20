import type {EvidenceAnalysis} from './evidence-analysis.js';
const escape = (value: unknown) => String(value ?? 'N/D').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = (value: number | null | undefined, digits = 4) => value == null ? 'N/D' : value.toLocaleString('es-CO', {maximumFractionDigits: digits});
function table(headers: readonly string[], rows: readonly (readonly unknown[])[]) {
  return '<div class="scroll"><table><thead><tr>' + headers.map(h => '<th>' + escape(h) + '</th>').join('')
    + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(c => '<td>' + escape(c) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>';
}
function bars(rows: readonly {label: string; value: number | null}[], unit: string) {
  const known = rows.filter(row => row.value !== null), max = Math.max(...known.map(row => row.value!), .000001);
  if (!known.length) return '<svg viewBox="0 0 800 80" role="img" aria-label="Sin datos"><text x="10" y="40">N/D: no hay mediciones compatibles.</text></svg>';
  return '<svg viewBox="0 0 1000 ' + (known.length * 44 + 20) + '" role="img" aria-label="Comparación ' + escape(unit) + '">'
    + known.map((row, i) => '<text x="5" y="' + (i * 44 + 18) + '">' + escape(row.label) + '</text>'
      + '<rect x="460" y="' + (i * 44 + 3) + '" width="' + (row.value! / max * 350) + '" height="22" rx="3"/>'
      + '<text x="825" y="' + (i * 44 + 18) + '">' + number(row.value, 6) + ' ' + escape(unit) + '</text>').join('') + '</svg>';
}
function paretoChart(a: EvidenceAnalysis, time = false) {
  const points = a.pareto.filter(c => c.costPerAccepted !== null && c.acceptance !== null && (!time || c.medianAcceptedWallMs !== null));
  const maxX = Math.max(...points.map(p => p.costPerAccepted!), .000001);
  const maxY = time ? Math.max(...points.map(p => p.medianAcceptedWallMs!), 1) : 1;
  return '<svg viewBox="0 0 820 280" role="img" aria-label="Pareto por celdas compatibles">'
    + '<path d="M50 20V235H790" fill="none" stroke="#64748b"/>'
    + '<text x="280" y="270">Costo completo por resultado de calidad · USD</text>'
    + points.map(p => '<circle cx="' + (50 + p.costPerAccepted! / maxX * 700) + '" cy="'
      + (235 - (time ? p.medianAcceptedWallMs! : p.acceptance!) / maxY * 200) + '" r="7" fill="'
      + (p.dominated ? '#9ca3af' : '#0d9488') + '"><title>' + escape(p.task + ' · ' + p.recipe + ' · ' + p.protocol)
      + ' · n=' + p.n + ' · USD ' + number(p.costPerAccepted, 6) + ' · '
      + (time ? number(p.medianAcceptedWallMs! / 1000) + ' s' : number(p.acceptance! * 100) + ' %') + '</title></circle>').join('')
    + (!points.length ? '<text x="100" y="120">N/D: faltan costos completos y resultados con calidad.</text>' : '') + '</svg>';
}
function section(id: string, title: string, content: string) {return `<section id="${id}"><h2>${title}</h2>${content}</section>`;}
export function renderEvidenceReport(a: EvidenceAnalysis) {
  const decisions = table(['Tarea', 'Diseño × ejecución', 'Operación', 'Protocolo / contrato', 'Recetas, n y calidad', 'Decisión', 'Alternativa', 'Confianza', 'Qué falta'],
    a.decisions.map(d => [d.task, `${d.design ?? 'N/D'} × ${d.execution ?? 'N/D'}`, d.operation,
      `${d.protocol ?? 'N/D'} / ${d.contract?.slice(0, 12) ?? 'N/D'}`,
      d.candidates.map(c => `${c.recipe}: n=${c.n}; ${c.qualityAccepted} verificados, ${c.qualityMeasured} evaluados`).join('; '),
      d.recommendation ?? d.status, d.alternative, d.confidence, [...new Set(d.missing)].join('; ')]));
  const costTable = table(['Tarea / escenario', 'Protocolo', 'Receta', 'n', 'Contrato', 'Calidad', 'Gastado USD',
    'USD por aceptado', 'Mediana intento USD', 'Rango intento USD', 'Tiempo aceptado (s)', 'Evidencia'],
    a.cells.map(c => [c.task, c.protocol, c.recipe, c.n, `${c.contractAccepted}/${c.n}`,
      `${c.qualityAccepted} verificados / ${c.qualityMeasured} evaluados de ${c.n}`,
      number(c.observedCostMax, 6) + (c.completeCost ? '' : ' · subtotal; total N/D'), number(c.costPerAccepted, 6),
      number(c.medianAttemptCost, 6), c.attemptCostRange?.map(n => number(n, 6)).join('–'),
      c.medianAcceptedWallMs === null ? 'N/D' : number(c.medianAcceptedWallMs / 1000), c.evidenceIds.join(', ')]));
  const panels = [
    section('decision', '1. Tabla de decisión: calidad antes que costo', decisions +
      '<p>n &lt; 3, calidad &lt; 80 %, metadatos o costos incompletos: sin decisión. Las candidatas son exploratorias; no activan el router.</p>'),
    section('costos', 'Costo, tiempo y resultado por tarea', costTable
      + [...new Set(a.cells.map(c => c.task))].map(task => '<details><summary>' + escape(task) + ' · gráficos de gasto y calidad</summary>'
        + '<h3>Gasto observado, incluyendo fallos; no indica ganador</h3>'
        + bars(a.cells.filter(c => c.task === task).map(c => ({label: c.recipe + (c.completeCost ? '' : ' · subtotal'), value: c.observedCostMax})), 'USD')
        + '<h3>Costo por resultado con calidad verificada; una muestra no permite recomendar</h3>'
        + bars(a.cells.filter(c => c.task === task).map(c => ({label: c.recipe, value: c.costPerAccepted})), 'USD / calidad') + '</details>').join('')),
    section('pareto', '2. Pareto: costo frente a calidad y duración',
      '<p>Cada punto conserva su protocolo. El gris solo indica dominación dentro de su cohorte compatible. Pase el cursor para ver la tarea.</p>'
      + paretoChart(a) + paretoChart(a, true)),
    section('diseno', '3. Efecto del diseñador y del ejecutor', '<p>' + escape(a.designerEffect.reason)
      + '. El protocolo factorial entrega el mismo hash a cada ejecutor; estos efectos no se deducen de recetas que rediseñaron.</p>'),
    section('operaciones', '4. Dónde se va el consumo por operación y modelo',
      table(['Protocolo', 'Operación', 'Modelo', 'Llamadas', 'Entrada', 'Salida', 'Caché leída', 'Caché escrita', 'Escritura 5m', 'Escritura 1h', 'USD atribuible'],
        a.operations.map(o => [o.protocol, o.operation, o.model, o.calls, number(o.input, 0), number(o.output, 0),
          number(o.cacheRead, 0), number(o.cacheWrite, 0), number(o.cacheWrite5m, 0), number(o.cacheWrite1h, 0), number(o.usd, 6)]))
      + '<p>El total de llamadas no es el total de ensayos. La asignación ambigua queda como desconocida. A/B de exploración: '
      + escape(a.explorationAB.reason) + '. No se reparte costo entre operaciones sin recibos.</p>'),
    section('cache', '5. Caché y contexto por llamada',
      table(['Protocolo', 'Modelo', 'Condición solicitada', 'Aciertos', 'Contexto máximo observado', 'Cobertura', 'Costo causal del cambio'],
        a.cache.map(c => [c.protocol, c.model, c.condition, c.hitRatio === null ? 'N/D' : number(c.hitRatio * 100) + ' %',
          number(c.observedContextMax, 0), c.contextCoverage, 'N/D: ' + c.reason]))
      + '<p>El máximo observado no cubre llamadas sin contadores. Fría/caliente es una etiqueta solicitada; no garantiza vaciar caché.</p>'),
    section('handoff', '6. Traspaso frente a resultado', table(['Protocolo', 'Hash de traspaso', 'Corridas', 'Calidad aceptada'],
      a.handoffs.map(h => [h.protocol, h.hash, h.runs, h.accepted]))
      + '<p>Tamaño en tokens y campos históricos completos: N/D donde falta artefacto. Una asociación no demuestra causalidad.</p>'),
    section('escalados', '7. Escalados y precisión del triador', '<p>Comparaciones con etiqueta humana independiente: '
      + a.triage.measured + '. Aciertos: ' + a.triage.correct + '. Precisión: ' + number(a.triage.accuracy) + '.</p>'),
    section('fallos', '8. Taxonomía de fallos', table(['Protocolo', 'Receta', 'Motivo comprobado', 'Intentos'],
      a.failures.map(f => [f.protocol, f.recipe, f.reason ?? 'N/D: no hay causa verificada', f.count]))),
    section('sombra', '9. Router en sombra: aciertos y desacuerdos', table(['Evidencia', 'Propuesta sombra', 'Mejor receta observada', 'Coincide'],
      a.shadow.confusion.map(c => [c.id, c.predicted, c.observed, c.match]))
      + '<p>Sin una receta observada elegible no se puntúa el acierto. Matriz pendiente cuando haya decisiones comparables.</p>'),
    section('faltantes', '10. Qué falta para decidir', '<p>Las lagunas de cada celda aparecen en la tabla inicial. '
      + 'El presupuesto y orden reproducible están en <a href="campaign.json">campaign.json</a>; son estimaciones, no consumo medido.</p>'),
    section('politica', '11. Política propuesta', '<pre>' + escape(JSON.stringify(a.proposedPolicy, null, 2))
      + '</pre><p>Solo sombra. La política activa y las protecciones del host no se sustituyen.</p>'),
  ];
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>VPR · Evidencia y decisiones</title><style>
body{font:15px system-ui;background:#f1f5f9;color:#172033;margin:0}main{max-width:1500px;margin:auto;padding:24px}
section,header{background:white;padding:24px;border-radius:12px;margin-bottom:20px}h1,h2{color:#12394b}
.scroll{overflow:auto}table{border-collapse:collapse;min-width:900px;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #dbe3ed}
th{background:#e8f0f6}td{max-width:380px;overflow-wrap:anywhere}svg{width:100%;max-height:1000px}svg rect{fill:#0d9488}svg text{font:13px system-ui}
pre{overflow:auto;white-space:pre-wrap}a{color:#096c85}.note{padding:14px;background:#fff7dd;border-left:4px solid #d49b13}
@media print{section{break-inside:avoid}.scroll{overflow:visible}td,th{font-size:9px}}
</style><main><header><h1>VPR: evidencia, calidad y costo-beneficio</h1>
<p>${a.runs} ejecuciones y ${a.calls} llamadas observadas. Total de referencia conocido: USD ${number(a.observedCostMax, 6)}
${a.completeCost ? '' : ' · subtotal; total completo N/D'}.</p>
<p class="note">Aceptar pruebas acotadas no garantiza calidad general. Esta página no demuestra ahorro de cuota de suscripción.
No hubo nuevas llamadas a modelos para generar el informe.</p>
<p><a href="detail/informe.html">Comparativa detallada por escenario, modelo y categoría de token</a> ·
<a href="analysis.json">Análisis JSON</a> · <a href="evidence.json">Recibos canónicos</a> ·
<a href="price-catalogs.json">Tarifas de referencia y fechas</a></p></header>${panels.join('\n')}</main></html>`;
}
