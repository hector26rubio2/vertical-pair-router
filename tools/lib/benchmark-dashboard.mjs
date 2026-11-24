import { renderDashboardDocument } from "./benchmark-dashboard-template.mjs";
import {
  analyzeTask,
  contextEvidence,
  comparisonSelection,
  executionBlocker,
} from "./benchmark-analysis.mjs";
import { allocationPanel, coveragePanel, phaseLabel } from "./benchmark-cost-allocation.mjs";
import { taskVerdict } from "./benchmark-verdict.mjs";
import {
  taskDecisionPanel,
  conclusionOverview,
  methodologyPanel,
} from "./benchmark-verdict-view.mjs";
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
const color = (model) =>
  model === "time"
    ? "time"
    : model.startsWith("gpt-")
      ? "codex"
      : model.includes("haiku")
        ? "haiku"
        : model.includes("opus")
          ? "opus"
          : "sonnet";

function renderTaskSection(
  task,
  {
    report,
    descriptions,
    armLabel,
    comparisonTable,
    routingPanel,
    summary,
    profile,
    campaign,
    claudePrices,
    openaiPrices,
    analyses,
    verdicts,
  },
) {
  const selection = comparisonSelection(task, report.rows),
    rows = selection.selected,
    a = analyses.find((a) => a.taskId === task.id);
  const verdict = verdicts.find((v) => v.taskId === task.id);
  const analysisTask = task.executionRole === "inventory" || task.id === "F01",
    staged = task.protocol === "staged-recipe-v1";
  const metrics = [
    {
      id: "cost",
      title: "Costo total de cada ejecución · USD",
      value: (r) => r.totalCost?.max ?? r.observedModelCost?.max,
    },
    {
      id: "tokens",
      title: "Tokens totales de cada ejecución · todos los modelos",
      value: (r) => (r.models.length ? r.receipt?.totals?.totalTokens : null),
    },
    {
      id: "time",
      title: "Duración total · segundos, agentes + checks",
      value: (r) =>
        r.receipt?.timings?.wallMs == null
          ? null
          : (r.receipt.timings.wallMs +
              (r.localChecksTotalMs ??
                (r.checks?.own?.durationMs ?? 0) + (r.checks?.external?.durationMs ?? 0))) /
            1000,
    },
    {
      id: "checks",
      title: analysisTask
        ? "Estructura y citas comprobadas · no equivale a calidad general"
        : "Criterios externos aprobados · alcance limitado al contrato",
      value: (r) => r.checks?.external?.passed,
    },
  ];
  const charts = metrics
    .map((metric) => {
      const max =
        metric.id === "checks"
          ? task.testCount
          : Math.max(...rows.map((r) => metric.value(r) ?? 0), 0.000001);
      return /* HTML */ `<article class="chart-card">
        <h3>${metric.title}</h3>
        ${
rows

.map((row) => {
            const value = metric.value(row),
              complete = row.completeModelAccounting ??
row.receipt?.completeAccounting;
            const parts =
              metric.id === "cost"
                ?
row.models
.map((m) => ({ model: m.model, value: m.cost?.totalUsd?.max }))
                :
metric.id === "tokens"
                  ?
row.models
.map((m) => ({ model: m.model, value: m.totalTokens }))
                  :
[{ model: "time", value }];
            return /* HTML */ `<div class="bar-row">
              <div>
                ${e(armLabel(row.arm))}<small
                  >${row.status === "accepted" ?
(row.semanticReview && row.semanticReview !== "passed" ?
"Estructura/citas aprobadas · " + (row.semanticReview === "changes-requested" ?
"requiere correcciones" :
row.semanticReview === "reviewed-draft" ?
"borrador revisado, sin validar implementación" :
"revisión pendiente") :
row.qualityReview?.findings?.some((f) => ["critical", "high", "medium"].includes(f.severity)) ?
"Contrato aprobado · observaciones abiertas" :
"Aceptó el contrato") :
"INCOMPLETO"}${row.models.some((m) => m.cost?.modelIdentityCaveat) ?
" · precio condicional" :
""}</small
                >
              </div>
              <div class="track">
                ${value == null ?
"" :
parts
.map((p) => /* HTML */ `<span class="bar ${color(p.model)}" style="width:${(100 * (p.value ??
0)) / max}%" title="${e(p.model)}: ${e(metric.id === "cost" ?
usd({ min: p.value ??
0, max: p.value ??
0 }) :
n(p.value))}"></span>`)
.join("")}
              </div>
              <strong
                >${value == null ?
"N/D" :
metric.id === "cost" ?
"USD " + usd(row.totalCost ??
row.observedModelCost) :
metric.id === "checks" ?
n(value) + " / " + task.testCount :
n(value)}${!complete && value != null && metric.id !== "checks" ?
(metric.id === "time" ?
" · flujo incompleto" :
" · subtotal, total N/D") :
""}</strong
              >
            </div>`;
          })

.join("")
}${a.missing
          .filter((arm) => !a.strategies.some((s) => s.arm === arm))
          .map(
            (arm) => /* HTML */ `<div class="bar-row">
                <div>${e(armLabel(arm))}</div>
                <div class="track missing"></div>
                <strong>Sin probar · N/D</strong>
              </div>`,
          )
          .join("")}
      </article>`;
    })
    .join("");
  const context = rows
    .map((row) =>
      row.models
        .map((model) => {
          const c = contextEvidence(row, model);
          return /* HTML */ `<tr>
            <th>${e(armLabel(row.arm))}</th>
            <td>${e(model.model)}</td>
            <td>${n(c.observedMax)}</td>
            <td>${n(c.upperBound)}</td>
            <td>
              ${c.completePromptCoverage ? "Prompts cubiertos por contadores" : "Cobertura incompleta o no informada"}<small
                >${n(c.requestCount)} llamadas con contexto registrado</small
              >
            </td>
          </tr>`;
        })
        .join(""),
    )
    .join("");
  const audit =
    analysisTask || staged
      ? /* HTML */ `<details>
          <summary>Qué ocurrió y qué falló en cada intento</summary>
          <div class="table">
            <table>
              <thead>
                <tr>
                  <th>Ejecución</th>
                  <th>Resultado comprobado</th>
                  <th>Revisión del borrador</th>
                </tr>
              </thead>
              <tbody>
                ${
rows

.map((row) => {
                    const reason =
                      executionBlocker(row) ??
                      (row.minimumStandard && !row.minimumStandard.passed
                        ?
"No cumple el mínimo: " + row.minimumStandard.reasons
.join("; ")
                        :
row.receipt?.stopped === "deadline"
                          ?
"Se agotó el límite de tiempo sin entregar el artefacto; consumo observado parcial."
                          :
row.codexReceipt?.modelDispatched === false
                            ?
"El conector rechazó el plan antes de iniciar Codex. No es una prueba de su capacidad."
                            :
row.executorModel?.startsWith("gpt-") && !row.codexReceipt
                              ?
"No hay recibo de Codex; no se confirma su ejecución ni se supone consumo cero."
                              :
row.codexReceipt?.completed &&
                                  row.codexReceipt?.artifactValid === false
                                ?
"Codex respondió, pero no se pudo obtener un artefacto JSON válido."
                                :
row.checks?.external?.exitCode !== 0
                                  ?
"El artefacto no cumple todas las comprobaciones externas. Ver las referencias y criterios de la revisión."
                                  :
"Se verificaron estructura, citas y preservación del código; no demuestra implementación correcta.");
                    return /* HTML */ `<tr>
                      <th>${e(armLabel(row.arm))}</th>
                      <td>
                        ${e(reason)}<small
                          >${n(row.checks?.external?.passed)} / ${task.testCount}
                          comprobaciones</small
                        >${row.originalStatus && row.originalStatus !== row.status ?
"<small>Se corrigió el validador para permitir tareas de decisión sin archivos. Se conserva el resultado original en los datos.</small>" :
""}
                      </td>
                      <td>
                        ${e(row.semanticAssessment?.conclusion ??
"Sin aprobación de calidad de ingeniería.")}
                      </td>
                    </tr>`;
                  })

.join("")
}
              </tbody>
            </table>
          </div>
        </details>`
      : "";
  const contexts = rows.flatMap((row) =>
    row.models.map((model) => ({ row, model, c: contextEvidence(row, model) })),
  );
  const contextMax = Math.max(...contexts.map((v) => v.c.observedMax ?? 0), 1);
  const contextChart = /* HTML */ `<article class="chart-card">
    <h3>Contexto máximo observado por llamada · cada modelo separado</h3>
    <p>
      No se suman contextos de modelos o llamadas. N/D significa que no hay una medición exacta por
      llamada.
    </p>
    ${contexts
      .map(
        ({ row, model, c }) => /* HTML */ `<div class="bar-row">
            <div>${e(armLabel(row.arm))}<small>${e(model.model)} · ${e(model.role)}</small></div>
            <div class="track">
              ${c.observedMax == null ? "" : /* HTML */ `<span class="bar ${color(model.model)}" style="width:${(100 * c.observedMax) / contextMax}%"></span>`}
            </div>
            <strong
              >${n(c.observedMax)}
              tokens${model.model.includes("haiku") && c.observedMax > 100000 ? "<small>Supera 100.000; aplica tarifa de contexto largo</small>" : ""}</strong
            >
          </div>`,
      )
      .join("")}
  </article>`;
  const reviews = rows
    .filter((r) => r.semanticAssessment)
    .map(
      (r) => /* HTML */ `<article class="quality">
          <h3>Revisión del borrador · ${e(armLabel(r.arm))}</h3>
          <p><b>${e(r.semanticAssessment.conclusion)}</b></p>
          <p>Fortalezas observadas: ${e((r.semanticAssessment.strengths ?? []).join(" · "))}</p>
          <ul>
            ${(r.semanticAssessment.findings ?? []).map((f) => /* HTML */ `<li><b>${e(f.severity)}</b>: ${e(f.issue)}</li>`).join("")}
          </ul>
        </article>`,
    )
    .join("");
  return /* HTML */ `<section
    class="task-panel"
    id="case-${e(task.id.toLowerCase())}"
    data-task-panel="${e(task.id)}"
  >
    <div class="eyebrow">${e(task.id)} · ${e(task.level)} · clasificación manual</div>
    <h2>${e(task.name)}</h2>
    <p>
      Protocolo comparado: ${e(selection.policy)}. ${n(selection.excluded.length)} intentos de
      depuración u otro protocolo quedan fuera del ranking y conservan su costo en la tabla y
      exportaciones. ${n(selection.technicalBlocked)} bloqueos de integración/proveedor no se
      interpretan como calidad del modelo.
    </p>
    <p>${e(descriptions[task.id] ?? task.requirement)}</p>
    ${taskDecisionPanel(verdict, task, armLabel)}
    <div class="quality">
      <h3>Qué calidad está comprobada y qué falta</h3>
      <p>
        ${
          analysisTask
            ? "Esta tarea no implementa código. Las ocho comprobaciones verifican estructura, referencias, dependencias y preservación. Las recetas nuevas incluyen " +
              "además revisión semántica fresca; su aprobación se indica por ejecución. "
            : ""
        }Aprobar
        el contrato con observaciones medias abiertas no habilita una recomendación de calidad ni un
        caso positivo para el routing. La aceptación indicada corresponde a ${task.testCount}
        criterios externos de esta
        tarea${task.id === "P02" ? ", más compilación y la prueba original sin modificar" : task.id === "F02" ? ", más 12 regresiones conservadas y compilación de toda la app Angular" : ""}.
        Las pruebas escritas por el propio agente no sustituyen los criterios externos ni la
        revisión fresca.
      </p>
      <p>
        <b>Alcance de revisión:</b>
        ${
staged ?
"la sesión fresca de Sonnet está incluida en el costo y se verifican las citas de sus hallazgos. No es una revisión humana ni una garantía general." :
"no se midió una revisión independiente de diseño o mantenibilidad."
}
        No se midieron seguridad completa ni defectos posteriores. Aprobar estos checks no garantiza
        equivalencia con Opus o Sonnet ni ausencia de errores.
      </p>
    </div>
    ${reviews}${audit}
    <div class="charts">${charts}${contextChart}</div>
    ${allocationPanel(task, rows, armLabel)}
    <p class="legend">
      Colores por modelo: <b class="haiku">Haiku</b> <b class="sonnet">Sonnet</b>
      <b class="opus">Opus</b> <b class="codex">Codex</b>. Las barras de costo usan el extremo
      superior del rango. Los intentos fallidos conservan su consumo.
    </p>
    <h3>Contexto usado por modelo</h3>
    <p>
      ${task.sourceFiles ? `Instantánea: ${n(task.sourceFiles)} archivos reales seleccionados · ${n(task.sourceCharacters)} bytes. Es una copia parcial, no todo el proyecto. ` : ""}Máximo
      registrado de entrada de una llamada = entrada sin caché + caché leída + caché escrita. No es
      la suma de tokens de toda la ejecución. Si faltan llamadas se muestra cobertura incompleta; la
      cota superior no es una medición exacta. El máximo no incluye la salida ni muestra la
      ocupación en vivo del contexto.
    </p>
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Ejecución</th>
            <th>Modelo</th>
            <th>Máximo observado · tokens</th>
            <th>Cota superior · tokens</th>
            <th>Cobertura</th>
          </tr>
        </thead>
        <tbody>
          ${context || '<tr><td colspan="5">Sin contexto registrado</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="pending">
      <h3>POA · qué falta para decidir con más confianza</h3>
      <p>
        ${a.missing.length ? "Completar con el mismo contrato: " + e(a.missing.map(armLabel).join("; ")) + "." : "Las rutas previstas cuentan con resultados aceptados dentro de este protocolo."}
      </p>
      <ol>
        <li>
          Repetir cada combinación al menos tres veces desde la misma instantánea, controlando caché
          y orden. Tres muestras siguen siendo evidencia limitada.
        </li>
        <li>
          Añadir revisión independiente de diseño y código, tests adversariales, regresiones y
          criterios de seguridad adecuados al cambio.
        </li>
        <li>
          Comparar costo por resultado aceptado, tiempo y defectos detectados. Preferir la ruta de
          menor costo que cumpla los criterios de calidad y riesgo.
        </li>
      </ol>
    </div>
  </section>`;
}

export function benchmarkDashboard({
  report,
  descriptions,
  armLabel,
  comparisonTable,
  routingPanel,
  summary,
  profile,
  campaign,
  claudePrices,
  openaiPrices,
}) {
  const orderedTasks = [...report.tasks].sort(
    (a, b) =>
      (["F02", "F01B", "F01"].indexOf(a.id) < 0 ? 99 : ["F02", "F01B", "F01"].indexOf(a.id)) -
      (["F02", "F01B", "F01"].indexOf(b.id) < 0 ? 99 : ["F02", "F01B", "F01"].indexOf(b.id)),
  );
  const analyses = report.tasks.map((task) => analyzeTask(task, report.rows));
  const verdicts = report.tasks.map((task) => taskVerdict(task, report.rows));
  const sections = orderedTasks
    .map((task) =>
      renderTaskSection(task, {
        report,
        descriptions,
        armLabel,
        comparisonTable,
        routingPanel,
        summary,
        profile,
        campaign,
        claudePrices,
        openaiPrices,
        analyses,
        verdicts,
      }),
    )
    .join("");
  const configured = (profile?.orchestration?.models ?? [])
    .map(
      (m) => /* HTML */ `<li>
          ${e(m.id)}: ${e(m.model)} · ${e(m.effort)} · roles ${e(m.roles.join(", "))}
        </li>`,
    )
    .join("");
  const priceRows = claudePrices.cards
    .filter((c) => /haiku|sonnet|opus/.test(c.model))
    .flatMap((c) =>
      c.tiers.map(
        (t) => /* HTML */ `<tr>
            <th>${e(c.model)}</th>
            <td>
              ${t.maxPromptTokens ? "Hasta " + n(t.maxPromptTokens) : c.tiers.length > 1 ? "Más de " + n(c.tiers[0].maxPromptTokens) : "Todos"}
            </td>
            <td>${t.input}</td>
            <td>${t.output}</td>
            <td>${t.cacheRead}</td>
            <td>${t.cacheWrite5m} / ${t.cacheWrite1h}<small>5 minutos / 1 hora</small></td>
          </tr>`,
      ),
    )
    .join("");
  const openaiRateRows = (openaiPrices?.cards ?? [])
    .flatMap((c) =>
      [
        { tier: c, label: "Contexto corto" },
        ...(c.longContext
          ? [
              {
                tier: c.longContext,
                label: "Contexto largo · extremo del intervalo si no se conoce cada petición",
              },
            ]
          : []),
      ].map(
        ({ tier: t, label }) => /* HTML */ `<tr>
            <th>${e(c.model)} (solicitado)</th>
            <td>${label}</td>
            <td>${t.input}</td>
            <td>${t.output}</td>
            <td>${t.cacheRead}</td>
            <td>${t.cacheWrite30m} / ${t.cacheWrite12h}<small>30 minutos / 12 horas</small></td>
          </tr>`,
      ),
    )
    .join("");
  const campaignPanel = campaign
    ? /* HTML */ `<section id="finanzas-campaign">
        <h2>POA · trabajo real en Finanzas</h2>
        <p>
          Se preservan los proyectos originales y sus cambios locales. Las mediciones se hacen en
          copias parciales o completas según cada prueba, sin base de datos real, extractos ni
          secretos.
        </p>
        <div class="table">
          <table>
            <thead>
              <tr>
                <th>Tarea real</th>
                <th>Nivel</th>
                <th>Estado</th>
                <th>Cómo se evaluará la calidad</th>
              </tr>
            </thead>
            <tbody>
              ${
campaign.tasks

.map(
                  (t) => /* HTML */ `<tr>
                      <th>${e(t.id)} · ${e(t.task)}</th>
                      <td>${e(t.level)}</td>
                      <td>
                        ${report.rows.some((r) => r.taskId === t.id) ?
"Ver ejecuciones y resultados registrados" :
t.status === "planned-not-executed" ?
"Planificada; sin medición" :
"Preparada / en ejecución; sin resultado aún"}
                      </td>
                      <td>${e(Array.isArray(t.quality) ?
t.quality
.join(" · ") :
t.quality)}</td>
                    </tr>`,
                )

.join("")
}
            </tbody>
          </table>
        </div>
        <p>
          Los riesgos de código detectados son hipótesis hasta reproducirlos. Las tareas
          planificadas no cuentan como pruebas ejecutadas ni como ahorros.
        </p>
      </section>`
    : "";
  return {
    analyses,
    verdicts,
    html: renderDashboardDocument({
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
    }),
  };
}
