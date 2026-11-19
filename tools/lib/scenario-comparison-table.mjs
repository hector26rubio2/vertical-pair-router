const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const num = (value) => (value == null ? "N/D" : value.toLocaleString("es-CO"));
const money = (value) =>
  value == null
    ? "N/D"
    : value.min === value.max
      ? value.min.toFixed(8)
      : `${value.min.toFixed(8)}–${value.max.toFixed(8)}`;
const keys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"];
const phaseName = (phase) =>
  ({
    plan: "Planificación",
    architecture: "Arquitectura",
    "technical-plan": "Plan técnico",
    implement: "Ejecución",
    review: "Revisión",
    repair: "Corrección",
  })[phase] ?? phase;

export function comparisonBreakdown(row) {
  const phases = (row.phaseCosts ?? []).flatMap((phase) =>
    (phase.models ?? []).map((model) => ({
      ...model,
      role: phaseName(phase.phase) + (phase.iteration ? " · corrección " + phase.iteration : ""),
      phaseWallMs: phase.receipt?.timings?.wallMs,
    })),
  );
  if (!phases.length) return row.models ?? [];
  const totals = executionSum(row);
  if (
    !keys.every(
      (key) =>
        totals[key] !== null &&
        phases.every((model) => Number.isFinite(model[key])) &&
        phases.reduce((sum, model) => sum + model[key], 0) === totals[key],
    )
  )
    return row.models ?? [];
  const costs = phases.map((model) => model.cost?.totalUsd);
  if (
    !totals.cost ||
    costs.some((cost) => !cost) ||
    Math.abs(costs.reduce((sum, cost) => sum + cost.max, 0) - totals.cost.max) > 1e-8
  )
    return row.models ?? [];
  return phases;
}

// Sum only model rows. Never add the receipt TOTAL a second time.
export function executionSum(row) {
  const models = row.models ?? [];
  const totals = Object.fromEntries(
    keys.map((key) => [
      key,
      models.length && models.every((model) => Number.isFinite(model[key]))
        ? models.reduce((sum, model) => sum + model[key], 0)
        : null,
    ]),
  );
  for (const key of keys)
    if (
      totals[key] != null &&
      row.receipt?.totals?.[key] != null &&
      totals[key] !== row.receipt.totals[key]
    )
      throw new Error(`Accounting mismatch: ${row.taskId}/${row.arm}/${key}`);
  const costs = models.map((model) => model.cost?.totalUsd);
  const expected =
    row.requiredModelIds ?? [row.coordinatorModel, row.executorModel].filter(Boolean);
  const covered = expected.every((id) => models.some((model) => model.model === id));
  return {
    ...totals,
    cost:
      covered && row.totalCost !== null && costs.length && costs.every((cost) => cost != null)
        ? {
            min: costs.reduce((sum, cost) => sum + cost.min, 0),
            max: costs.reduce((sum, cost) => sum + cost.max, 0),
          }
        : null,
  };
}

export function scenarioComparisonTable({ tasks, rows, descriptions, armLabel }) {
  const body = tasks
    .map((task) => {
      const executions = rows.filter((row) => row.taskId === task.id);
      const span = executions.reduce(
        (sum, row) => sum + Math.max(1, comparisonBreakdown(row).length) + 1,
        0,
      );
      let firstTaskRow = true;
      const taskCells = () => {
        if (!firstTaskRow) return "";
        firstTaskRow = false;
        return /* HTML */ `<th rowspan="${span}" scope="rowgroup">${esc(task.id)} · ${esc(task.name)}
          </th>
          <td rowspan="${span}">
            ${esc(task.level)}<small>Clasificación manual de esta prueba</small>
          </td>
          <td rowspan="${span}" class="scenario">
            ${esc(descriptions[task.id] ?? task.requirement)}<small
              >Aceptación: ${num(task.testCount)} criterios externos. Mismo contrato para las
              combinaciones de esta tarea.</small
            >
            <details>
              <summary>Ver instrucción original de la prueba</summary>
              <pre style="white-space:pre-wrap">${esc(task.requirement)}</pre>
            </details>
          </td>`;
      };
      const content = executions
        .map((row, index) => {
          const models = comparisonBreakdown(row);
          const sum = executionSum(row);
          const checkMs =
            row.localChecksTotalMs ??
            (row.checks?.own?.durationMs ?? 0) + (row.checks?.external?.durationMs ?? 0);
          const fullMs = row.receipt?.timings?.wallMs;
          const result =
            "" +
            (row.status === "accepted"
              ? row.semanticReview && row.semanticReview !== "passed"
                ? "ESTRUCTURA/CITAS APROBADAS · REVISIÓN SEMÁNTICA PENDIENTE"
                : row.qualityReview?.findings?.some((f) =>
                      ["critical", "high", "medium"].includes(f.severity),
                    )
                  ? "CONTRATO APROBADO · OBSERVACIONES ABIERTAS"
                  : "CONTRATO APROBADO"
              : "INCOMPLETO") +
            " · externas " +
            (row.checks?.external?.passed ?? "N/D") +
            "/" +
            task.testCount +
            "";
          const combo = /* HTML */ `<th
            rowspan="${Math.max(1, models.length) + 1}"
            scope="rowgroup"
          >
            ${esc(armLabel(row.arm))}<small>${esc(task.id)} · ejecución ${index + 1}</small
            ><small>${esc(result)}</small
            ><small
              >${row.executionRole === "review" ? "Revisión; no implementa" : row.executionRole === "inventory" ? "Análisis; no implementa" : "Implementación o análisis según el contrato"}</small
            >
          </th>`;
          const time = (model) => {
            if (model.phaseWallMs != null) return `${num(model.phaseWallMs / 1000)} s (fase)`;
            if (!row.coordinatorModel) return fullMs == null ? "N/D" : `${num(fullMs / 1000)} s`;
            const childMs =
              row.codexReceipt?.durationMs ?? row.receipt?.timings?.childForegroundSpanMs;
            const worker =
              model.provider === "codex" ||
              model.model === row.executorModel ||
              model.role?.startsWith("ejecutor");
            const ms = worker
              ? childMs
              : (row.receipt?.timings?.mainOutsideChildSpanMs ??
                (fullMs != null && childMs != null ? fullMs - childMs : null));
            return ms == null ? "N/D" : `${num(ms / 1000)} s (intervalo)`;
          };
          const inputTotal = (model) =>
            [model.inputTokens, model.cacheReadTokens, model.cacheWriteTokens].every(
              Number.isFinite,
            )
              ? model.inputTokens + model.cacheReadTokens + model.cacheWriteTokens
              : null;
          const numeric = (model, cost) => /* HTML */ `<td>
                ${num(model.inputTokens)}<small>USD ${money(cost?.inputUsd)}</small>
              </td>
              <td>
                ${num(inputTotal(model))}<small
                  >Sin caché + lectura + escritura; parte del total</small
                >
              </td>
              <td>${num(model.outputTokens)}<small>USD ${money(cost?.outputUsd)}</small></td>
              <td>${num(model.cacheReadTokens)}<small>USD ${money(cost?.cacheReadUsd)}</small></td>
              <td>
                ${num(model.cacheWriteTokens)}<small>USD ${money(cost?.cacheWriteUsd)}</small>
              </td>
              <td>${num(model.totalTokens)}</td>`;
          const modelRows = models.length
            ? models
                .map(
                  (model, i) => /* HTML */ `<tr>
                      ${taskCells()}${i === 0 ? combo : ""}
                      <th scope="row">
                        ${esc(model.model)}${model.cost?.modelIdentityCaveat ? "<small>Modelo solicitado; respuesta no identificada por el host</small>" : ""}
                      </th>
                      <td>${esc(model.role)}</td>
                      ${numeric(model, model.cost)}
                      <td>${time(model)}</td>
                      <td>USD ${money(model.cost?.totalUsd)}</td>
                    </tr>`,
                )
                .join("")
            : /* HTML */ `<tr>
                ${taskCells()}${combo}
                <td colspan="10">
                  No se recibió consumo por modelo. No se interpreta como ejecución gratuita.
                </td>
              </tr>`;
          const expression = (key) =>
            sum[key] == null
              ? "N/D"
              : `${models.map((model) => num(model[key])).join(" + ")} = <strong>${num(sum[key])}</strong>`;
          const categoryExpression = (category) => {
            const costs = models.map((model) => model.cost?.[category]);
            if (!costs.length || costs.some((cost) => cost == null)) return "N/D";
            const total = {
              min: costs.reduce((s, c) => s + c.min, 0),
              max: costs.reduce((s, c) => s + c.max, 0),
            };
            return costs.map(money).join(" + ") + " = " + money(total);
          };
          const categories = {
            inputTokens: "inputUsd",
            outputTokens: "outputUsd",
            cacheReadTokens: "cacheReadUsd",
            cacheWriteTokens: "cacheWriteUsd",
          };
          const partial = sum.cost === null || row.receipt?.completeAccounting === false;
          const costExpression =
            sum.cost == null
              ? `${models.map((model) => money(model.cost?.totalUsd)).join(" + ")} + costo no informado = N/D completo`
              : `${models.map((model) => money(model.cost.totalUsd)).join(" + ")} = <strong>${money(sum.cost)}</strong>${partial ? " · subtotal observado" : ""}`;
          return (
            modelRows +
            /* HTML */ `<tr class="total" data-execution-total="${esc(task.id + "/" + row.arm)}">
              <th colspan="2">
                ${partial ? "SUBTOTAL OBSERVADO · INCOMPLETO" : "SUMA DE ESTA EJECUCIÓN"}<small
                  >${esc(models.map((model) => model.model).join(" + "))}</small
                >
              </th>
              ${keys
                .map(
                  (key) =>
                    "" +
                    (key === "outputTokens"
                      ? /* HTML */ `<td>${models.map((model) => num(inputTotal(model))).join(" + ")} = <strong>${num(sum.totalTokens == null ? null : sum.totalTokens - sum.outputTokens)}</strong></td>`
                      : "") +
                    "<td>" +
                    expression(key) +
                    "" +
                    (categories[key]
                      ? /* HTML */ `<small>USD ${categoryExpression(categories[key])}</small>`
                      : "") +
                    "</td>",
                )
                .join("")}
              <td>
                ${fullMs == null ? "N/D" : num((fullMs + checkMs) / 1000) + " s total"}<small
                  >Agentes ${num(fullMs == null ? null : fullMs / 1000)} s + checks
                  ${num(checkMs / 1000)} s</small
                >
              </td>
              <td>USD ${costExpression}</td>
            </tr>`
          );
        })
        .join("");
      return /* HTML */ `<tbody data-task="${esc(task.id)}">
        ${content}
      </tbody>`;
    })
    .join("");
  return /* HTML */ `<section id="comparison">
      <h2>Tabla única · tarea, escenario y consumo de cada modelo</h2>
      <p>
        Cada bloque contiene sus modelos y la suma. Cuando hay recibos por fase, Sonnet planificador
        y Sonnet revisor aparecen separados: no se cobra ni se suma dos veces su agregado. Entrada =
        tokens sin caché. Total tokens = entrada + salida + caché leída + caché escrita. Cada celda
        muestra tokens y USD; la última columna suma las cuatro categorías. Los USD son referencia
        oficial API, no cargos de suscripción.
      </p>
      <label
        >Ver tarea:
        <select id="task-filter">
          <option value="">Todas las tareas</option>
          ${tasks.map((task) => /* HTML */ `<option value="${esc(task.id)}">${esc(task.id)} · ${esc(task.name)}</option>`).join("")}
        </select></label
      >
      <div class="table">
        <table id="scenario-comparison">
          <thead>
            <tr>
              <th>Tarea</th>
              <th>Complejidad</th>
              <th>Escenario: qué se pidió hacer</th>
              <th>Ejecución / combinación</th>
              <th>Modelo</th>
              <th>Rol / fase</th>
              <th>Entrada sin caché · tokens / USD</th>
              <th>Input total · incluye caché</th>
              <th>Salida · tokens / USD</th>
              <th>Caché leída · tokens / USD</th>
              <th>Caché escrita · tokens / USD</th>
              <th>Total tokens</th>
              <th>Tiempo observado</th>
              <th>Costo modelo / suma · USD</th>
            </tr>
          </thead>
          ${body}
        </table>
      </div>
    </section>
    <script>
      document.getElementById("task-filter").addEventListener("change", (event) => {
        for (const group of document.querySelectorAll("#scenario-comparison tbody"))
          group.hidden = Boolean(event.target.value && group.dataset.task !== event.target.value);
      });
    </script>`;
}
