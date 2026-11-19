import { readFileSync } from "node:fs";
import { coveragePanel } from "./benchmark-cost-allocation.mjs";
import { conclusionOverview, methodologyPanel } from "./benchmark-verdict-view.mjs";
const e = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const n = (v) =>
  v == null ? "N/D" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: 3 });
const usd = (v) =>
  !v
    ? "N/D"
    : Math.abs(v.max - v.min) < 1e-10
      ? v.min.toFixed(8)
      : `${v.min.toFixed(8)}–${v.max.toFixed(8)}`;
const dashboardCss = readFileSync(new URL("./benchmark-dashboard.css", import.meta.url), "utf8");
const dashboardClient = readFileSync(
  new URL("./benchmark-dashboard.client.js", import.meta.url),
  "utf8",
);
export function renderDashboardDocument({
  report,
  summary,
  orderedTasks,
  sections,
  verdicts,
  armLabel,
  campaignPanel,
  profile,
  configured,
  comparisonTable,
  claudePrices,
  openaiPrices,
  priceRows,
  openaiRateRows,
  routingPanel,
}) {
  return /* HTML */ `<!doctype html>
    <html lang="es">
      <meta charset="utf-8" /><meta
        name="viewport"
        content="width=device-width,initial-scale=1"
      /><title>VPR · panel de pruebas y decisiones</title
      ><style>
        ${dashboardCss}
      </style>
      <main>
        <header>
          <div class="eyebrow">VPR · análisis exploratorio · datos locales</div>
          <h1>Qué ruta resuelve cada tarea, a qué costo y con qué evidencia</h1>
          <p>
            ${report.tasks.length} tareas · ${report.rows.length} ejecuciones ·
            ${n(summary.totalObservedTokens)} tokens registrados. No se ha vuelto a ejecutar ningún
            modelo para construir este panel.
          </p>
          <p>
            <b>Menor costo no significa mejor calidad.</b> Se separan aceptación del contrato,
            costo, tiempo y contexto. Las recetas nuevas incluyen revisión fresca por Sonnet; las
            pruebas antiguas no acreditan ese mínimo. En F01 se muestran observaciones del
            coordinador sobre borradores concretos; esa revisión no fue ciega y el consumo de este
            chat no forma parte de los recibos. No hay costo completo de revisión independiente.
          </p>
        </header>
        <div class="toolbar">
          <label
            >Tarea
            <select id="panel-task">
              <option value="">Todas</option>
              ${orderedTasks.map((t) => /* HTML */ `<option value="${e(t.id)}">${e(t.id)} · ${e(t.name)}</option>`).join("")}
            </select></label
          ><a href="#ledger">Desglose por modelo</a><a href="#conclusions">Conclusiones</a
          ><a href="#methodology">Metodología</a><a href="#coverage">Cobertura por nivel</a
          ><a href="#finanzas-campaign">Plan de pruebas</a
          ><a href="#rack-state">Estado del RAG y routing</a
          ><a href="#prices">Tarifas y auditoría</a>
        </div>
        ${conclusionOverview(verdicts, armLabel)}${sections}${coveragePanel(report.tasks, report.rows, armLabel)}${methodologyPanel()}${campaignPanel}
        <section id="rack-state">
          <h2>Cómo está el RAG y el enrutamiento hoy</h2>
          <p>
            La recuperación local de casos y las reglas no llaman a modelos. El motor actual recibe
            complejidad, riesgo y necesidad de planificación como metadatos: todavía no demuestra
            una clasificación autónoma de cualquier petición ni calidad de ingeniería sénior. Las
            comprobaciones de calidad semántica de F01 están fuera del aprendizaje hasta aprobarse.
            Se filtra primero por proveedor autorizado, cuenta disponible, modelo/esfuerzo,
            permisos, rol y cuota informada. Sin evidencia comparable suficiente se aplican reglas
            de complejidad y riesgo; no se afirma que la ruta sea óptima.
          </p>
          <p>
            Para comparar económicamente, el motor exige al menos tres casos válidos de cada
            candidato viable, con el mismo contrato, tipo, complejidad, riesgo, rol,
            proveedor/modelo/esfuerzo y precios vigentes. Usa costo total por aceptación, incluidos
            fallos, y excluye rutas con menos de 80% de aceptación observada cuando tienen
            suficientes muestras. Ese umbral es una regla del producto, no una garantía estadística
            de calidad.
          </p>
          <ul>
            <li>
              Simple y bajo riesgo, sin planificación necesaria: ejecutor ligero con checks y
              autorización.
            </li>
            <li>
              Necesita planificación: planificador estándar → ejecutor elegible por rol y evidencia
              → revisión. Haiku no es una elección económica probada por defecto.
            </li>
            <li>
              Complejo o alto riesgo: Opus o planificador avanzado → ejecutor autorizado → revisión.
            </li>
            <li>
              El ejecutor ligero puede trabajar en código sólo con autorización expresa y checks. Un
              fallo detiene el flujo.
            </li>
          </ul>
          <h3>Configuración local leída, no una ejecución simulada</h3>
          <p>
            Proveedores autorizados:
            ${e((profile?.policy?.allowedProviders ?? []).join(", ")) || "No disponible"}. Ejecución
            de checks externos:
            ${profile?.policy?.allowShell === true ? "permitida" : "bloqueada en este perfil; requiere un perfil de pruebas autorizado"}.
            Máximo de trabajadores: ${n(profile?.orchestration?.maxWorkers)}.
          </p>
          <ul>
            ${configured}
          </ul>
          <p>
            Las pruebas controladas no demuestran que el RAG eligiera autónomamente sus
            combinaciones. Sonnet→Codex Terra y Sonnet→Codex Sol completaron los checks de
            implementación F02; Terra quedó con hallazgos bajos y Sol con un hallazgo medio. Los
            intentos Opus→Codex no llegaron a delegar. Copilot está preparado pero sin prueba
            generativa en esta cuenta. Haiku: política de compactación desde 90.000 tokens y techo
            de 100.000, tanto principal como subagente. Verificado en la prueba real: dos
            compactaciones automáticas; máximo de entrada observado de Haiku 54.391 tokens. Una
            solicitud sintética estimada en 452.168 tokens fue bloqueada antes de generar tokens. El
            contador oficial es una estimación; se reserva un margen de 10.000. Los entornos
            corporativos requieren verificar que el host permita esta protección.
          </p>
        </section>
        <details id="ledger">
          <summary>Abrir tabla única: tokens y USD por modelo, con sumas de cada ejecución</summary>
          ${comparisonTable}
        </details>
        <section id="prices">
          <h2>Por qué tokens parecidos no implican precios iguales</h2>
          <p>
            El cálculo usa cada categoría por separado: (entrada × tarifa entrada + salida × tarifa
            salida + lectura × tarifa lectura + escritura × tarifa escritura) / 1.000.000. La mezcla
            de caché y salida cambia el resultado. Los nombres y las tarifas se muestran
            explícitamente para no confundir tareas distintas ni precios redondeados.
          </p>
          <p>
            Con los mismos contadores y el mismo nivel de contexto, Haiku y Sonnet tienen tarifas
            distintas. Por ejemplo: 10.000 de entrada sin caché y 1.000 de salida, sin caché, son
            USD 0,00150000 en Haiku base y USD 0,03000000 en Sonnet según el catálogo comprobado; es
            una ilustración, no otra prueba ejecutada.
          </p>
          <div class="table">
            <table>
              <caption>
                USD / millón de tokens ·
                <a href="https://platform.claude.com/docs/es/about-claude/pricing"
                  >fuente oficial Claude</a
                >
                · comprobada ${e(claudePrices.checkedAt)}
              </caption>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Contexto por prompt</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Lectura caché</th>
                  <th>Escritura · plazo corto / largo</th>
                </tr>
              </thead>
              <tbody>
                ${priceRows}${openaiRateRows}
              </tbody>
            </table>
          </div>
          <p>
            <a href="https://developers.openai.com/api/docs/pricing">Fuente oficial OpenAI</a>;
            catálogo usado ${e(openaiPrices?.checkedAt)}. Cuando no se conoce cada contexto Codex,
            el cálculo conserva un intervalo entre tarifas oficiales de contexto corto/largo. La
            entrada acumulada no es el tamaño de una petición.
          </p>
          <p>
            Son referencias API, no cargos ni cuota de suscripción. Los rangos conservan
            incertidumbre de caché. Los modelos Codex son solicitados: el host no confirma la
            identidad de respuesta, por lo que sus precios son condicionales. Contabilidad ausente
            se muestra N/D. Subtotal de todos los modelos con contadores disponibles, incluidos
            componentes de flujos incompletos: USD
            ${usd(summary.totalKnownModelReferenceUsd ?? summary.totalReferenceUsd)}.
            ${summary.hasIncompleteAccounting ? "Hay contabilidad incompleta: el total completo es N/D y no se interpreta consumo ausente como cero." : "Contabilidad completa para los contadores incluidos."}
          </p>
          <p>
            Exportaciones: <a href="ejecuciones.csv">CSV por modelo</a> ·
            <a href="analysis.json">Análisis por tarea</a> ·
            <a href="data.json">Contadores originales agregados</a>. Informe generado
            ${e(summary.at)}.
          </p>
        </section>
        <details>
          <summary>Detalle adicional de filtros del proveedor</summary>
          ${routingPanel}
        </details>
      </main>
      <script>
        ${dashboardClient};
      </script>
    </html>`;
}
