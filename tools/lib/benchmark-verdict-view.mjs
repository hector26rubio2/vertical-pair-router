const e = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const money = (v) =>
  !v ? "N/D" : v.min.toFixed(5) + (Math.abs(v.max - v.min) > 1e-10 ? "–" + v.max.toFixed(5) : "");
const labels = {
  "quality-passed": "Cumple el mínimo de calidad",
  "checks-only-or-open-review": "Checks aprobados; calidad pendiente",
  "not-accepted": "Intentado sin aprobar",
  "not-tested": "No probado",
};

export function verdictHeadline(v, label) {
  if (v.pilotChoice) return "Mejor candidata para este piloto: " + label(v.pilotChoice) + ".";
  if (v.conclusion === "checks-only-no-engineering-winner")
    return "No hay ganador de ingeniería: sólo se compararon checks acotados.";
  if (v.conclusion === "incompatible-evidence")
    return "No hay comparación válida entre los contratos o protocolos disponibles.";
  if (v.conclusion === "quality-present-no-economic-winner")
    return v.qualityLeaders?.length === 1
      ? label(v.qualityLeaders[0]) +
          " es la única ruta con un resultado que pasó el mínimo; falta demostrar su costo-beneficio."
      : "Hay resultados con calidad validada, pero no un ganador económico demostrado.";
  return "Ninguna combinación alcanzó el mínimo de calidad exigido para recomendarla.";
}

export function taskDecisionPanel(v, task, label) {
  const winner = v.cells.find((c) => c.recipe === v.pilotChoice),
    fallback = v.cells.find((c) => c.recipe === v.fallbackChoice);
  const saving = v.savingAgainstSonnetPercent;
  const why = winner
    ? "Pasó " +
      task.testCount +
      " criterios externos, las verificaciones exigidas del alcance y una revisión fresca sin hallazgos medios, altos o críticos pendientes. Su costo completo por resultado con calidad es USD " +
      money(v.pilotCost) +
      "." +
      (saving && saving.min > 0
        ? ` La diferencia de referencia frente a Sonnet es ${saving.min.toFixed(1)}–${saving.max.toFixed(1)}% menos.`
        : "") +
      ""
    : v.labCandidate
      ? `${e(label(v.labCandidate))} es una candidata económica de laboratorio, no una conclusión de calidad sénior. Aprobar las mismas pruebas pequeñas no demuestra igual diseño, mantenibilidad ni seguridad. Falta revisión fresca comparable.`
      : "No se elige el más barato si no entregó el resultado, dejó defectos pendientes, faltan revisiones o la comparación no concilia contratos y costos.";
  const candidateRows = v.cells
    .map(
      (c) => /* HTML */ `<tr data-quality-state="${c.state}">
          <th>${e(label(c.recipe))}</th>
          <td>
            ${e(labels[c.state])}<small
              >Checks: ${c.checksPassed}/${c.attempts}; umbral de calidad:
              ${c.qualityPassed}/${c.attempts}; revisiones verificadas: ${c.freshReviews}.
              ${c.openFindings} hallazgos medios/altos/críticos acumulados en los intentos.</small
            >
          </td>
          <td>
            ${c.costPerQualityResult ? "USD " + money(c.costPerQualityResult) : "N/D"}
${c.observedCost ? /* HTML */ `<small>Gastado en los intentos: USD ${money(c.observedCost)}
${c.observedCostComplete ? "" : " · subtotal; total N/D"}.</small>` : ""}
${c.priceConditional ? "<small>Referencia condicional al modelo solicitado y contexto.</small>" : ""}
          </td>
          <td>
            ${c.meanQualityWallMs != null ? (c.meanQualityWallMs / 1000).toFixed(1) + " s" : c.meanAttemptWallMs != null ? (c.meanAttemptWallMs / 1000).toFixed(1) + " s · sin calidad aceptada" : "N/D"}<small
              >Agentes + checks. ${c.reviewSessions} revisiones ejecutadas; ${c.completedRepairs}
              correcciones completadas.</small
            >
          </td>
          <td>
            ${
!c.attempts ?
"Ejecutar con la misma tarea, snapshot y protocolo." :
!c.qualityPassed ?
e(c.failures[0]?.reason ??
"Revisión de calidad pendiente") :
c.recipe === v.pilotChoice ?
"Recomendada para repetir en piloto; conservar checks y revisión." :
c.recipe === v.fallbackChoice ?
"Alternativa de respaldo con precio no condicionado." :
!c.costPerQualityResult ?
"Hay resultado con calidad, pero falta costo completo comparable para recomendarlo." :
"Cumple el mínimo; comparar intervalos y repetir."
}<small
              >${c.executedPhases.length ? "Fases que sí terminaron: " + e(c.executedPhases.join(" · ")) : "No hay fases nativas completadas registradas."}</small
            >
          </td>
        </tr>`,
    )
    .join("");
  const priced = v.cells.filter(
    (c) => c.qualityPassed && c.costPerQualityResult && c.qualityRate >= 0.8,
  );
  const max = Math.max(...priced.map((c) => c.costPerQualityResult.max), 0.000001);
  const chart = priced.length
    ? /* HTML */ `<article class="chart-card quality-cost-chart">
        <h3>Costo comparado después de pasar el filtro de calidad</h3>
        <p>
          Sólo rutas que cumplieron el mínimo. La barra usa el extremo superior del intervalo. No
          incluye una ruta barata que haya fallado calidad.
        </p>
        ${priced
          .map(
            (c) => /* HTML */ `<div class="bar-row">
                <div>
                  ${e(label(c.recipe))}<small
                    >${c.qualityPassed}/${c.attempts} resultados con
                    calidad${c.priceConditional ? " · precio condicional" : ""}</small
                  >
                </div>
                <div class="track">
                  <span
                    class="bar ${c.recipe === v.pilotChoice ? "haiku" : "sonnet"}"
                    style="width:${(100 * c.costPerQualityResult.max) / max}%"
                  ></span>
                </div>
                <strong>USD ${money(c.costPerQualityResult)}</strong>
              </div>`,
          )
          .join("")}
      </article>`
    : "";
  return /* HTML */ `<div class="task-verdict" data-verdict="${e(v.taskId)}">
    <h3>Conclusión de esta tarea</h3>
    <p class="verdict-headline"><b>${e(verdictHeadline(v, label))}</b></p>
    <p>${why}</p>
    ${
      winner && v.pilotPriceConditional
        ? "<p>La ventaja económica es condicional: Codex informa el modelo solicitado y contadores acumulados, no confirma la identidad servida ni cada contexto. " +
          "Se conserva el intervalo oficial; no se presenta como ahorro garantizado de suscripción.</p>"
        : ""
    }
${fallback ? /* HTML */ `<p><b>Respaldo provisional:</b> ${e(label(fallback.recipe))}, USD ${money(fallback.costPerQualityResult)} por resultado con calidad.</p>` : ""}
${
      task.protocol === "staged-recipe-v1"
        ? "<p><b>Lectura de las recetas:</b> «Solo» se refiere al ejecutor. En esta serie se incluye la revisión común de otra sesión Sonnet. Las correcciones y " +
          "segundas revisiones también se cuentan; las fases no iniciadas no se inventan.</p>"
        : ""
    }
    <p>
      <b>¿Llegaron al mismo resultado?</b>
      ${
winner ?
"Las rutas calificadas alcanzaron el mismo umbral comprobado de esta tarea. Eso no demuestra que su código tenga idéntica calidad general." :
v.cells.some((c) => c.checksPassed) ?
"Algunas aprobaron los mismos criterios, pero falta demostrar que cumplan la misma revisión y el mínimo de ingeniería." :
"No hay resultados completos y revisados para afirmar equivalencia."
}
    </p>
    <p>
      <b>¿Puede decidirlo ya el RAG automáticamente?</b>
      ${
v.autoRoutingReady ?
"Hay repeticiones para el contrato acotado; aún rigen permisos y revisión." :
"No. Es una decisión de piloto o una laguna de evidencia, no una regla aprendida para todas las tareas de este nivel."
}
      Una sola ejecución no establece fiabilidad. La cobertura de criterios (${task.testCount}) no
      es el porcentaje de cobertura del código; esa medición no está disponible.
    </p>
    ${chart}
    <div class="table">
      <table>
        <caption>
          Calidad primero, después costo y tiempo · mismo escenario
        </caption>
        <thead>
          <tr>
            <th>Combinación completa</th>
            <th>Qué calidad está comprobada</th>
            <th>USD por resultado con calidad</th>
            <th>Tiempo observado</th>
            <th>Decisión y motivo</th>
          </tr>
        </thead>
        <tbody>
          ${candidateRows}
        </tbody>
      </table>
    </div>
    <details>
      <summary>Cobertura pendiente y siguiente experimento de esta tarea</summary>
      <p>
        <b>No probadas:</b>
        ${v.notTested.length ? e(v.notTested.map(label).join("; ")) : "Ninguna de las rutas previstas quedó sin intento."}
      </p>
      <p>
        <b>Intentadas sin calidad suficiente:</b>
        ${v.attemptedNotQualified.length ? e(v.attemptedNotQualified.map(label).join("; ")) : "Ninguna."}
        Estas rutas no se confunden con «no probado».
      </p>
      <p>
        Repetir las alternativas viables al menos tres veces con el mismo contrato, snapshot,
        protocolo de revisión y presupuesto predeclarado. Conservar fallos y reparaciones; revisar
        pruebas adversariales y seguridad según el riesgo. No promover una ruta por ahorrar tokens.
      </p>
    </details>
  </div>`;
}

export function conclusionOverview(verdicts, label) {
  const real = verdicts.find((v) => v.taskId === "F02");
  return /* HTML */ `<section id="conclusions">
    <h2>Conclusión: qué combinación conviene y qué no podemos afirmar</h2>
    <p>
      <b>Los datos no demuestran que Haiku sea el mejor para todo.</b> Los ensayos pequeños
      comprueban comportamientos acotados; muchos no tienen revisión fresca común. Su menor costo no
      prueba igual calidad de ingeniería.
    </p>
    ${
real ?
/* HTML */ `<p><b>Caso real ${e(real.name)}:</b> ${e(verdictHeadline(real, label))} ${real.pilotChoice ?
"USD " + money(real.pilotCost) + " por resultado con calidad, con la incertidumbre indicada." :
""} ${real.fallbackChoice ?
"Respaldo: " + e(label(real.fallbackChoice)) + "." :
""} No se generaliza a todos los proyectos ni a toda tarea «medio-alta».</p>` :
""
}
    <details>
      <summary>Conclusiones por tarea y nivel · ${verdicts.length} escenarios</summary>
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>Tarea y nivel</th>
              <th>Conclusión</th>
              <th>Alternativa económica de laboratorio</th>
              <th>Lagunas</th>
            </tr>
          </thead>
          <tbody>
            ${verdicts
              .map(
                (v) => /* HTML */ `<tr>
                    <th>
                      <a href="#case-${e(v.taskId.toLowerCase())}">${e(v.taskId)} · ${e(v.name)}</a
                      ><small>${e(v.level)}</small>
                    </th>
                    <td>
                      ${e(verdictHeadline(v, label))}<small
                        >${v.pilotCost ? "USD " + money(v.pilotCost) : "Sin costo/beneficio de ingeniería concluyente."}</small
                      >
                    </td>
                    <td>
                      ${v.labCandidate ? e(label(v.labCandidate)) + " · falta calidad comparable" : "—"}
                    </td>
                    <td>
                      ${v.notTested.length} combinaciones no probadas;
                      ${v.attemptedNotQualified.length} intentadas sin calidad suficiente.
                      ${v.autoRoutingReady ? "Repetición acotada disponible." : "No habilita aprendizaje automático."}
                    </td>
                  </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </details>
  </section>`;
}

export function methodologyPanel() {
  return /* HTML */ `<section id="methodology">
    <h2>Metodología para elegir ejecutor y orquestador</h2>
    <p>
      La unidad de comparación es <b>la misma tarea completa</b>: repositorio congelado, requisito,
      aceptación, riesgo y rol. «Simple», «media» o «compleja» no bastan para extrapolar entre
      proyectos.
    </p>
    <ol>
      <li>
        <b>Definir el resultado antes de ejecutar.</b> Requisitos, contexto disponible, rutas
        autorizadas, regresiones, criterios adversariales, revisión y presupuesto máximo. Declarar
        quién clasifica dificultad/riesgo; no simular que el RAG entiende cualquier texto sin ese
        trabajo.
      </li>
      <li>
        <b>Calidad antes que economía.</b> Todos los criterios externos, regresiones/compilación
        cuando correspondan, alcance preservado y revisión fresca con citas verificables. No
        recomendar con hallazgos medios, altos o críticos sin resolver. Seguridad e integración real
        requieren su propia evidencia; no se deducen de 9/9 tests.
      </li>
      <li>
        <b>Contar el flujo completo.</b> Lectura, análisis, planificación, implementación, revisión,
        reparaciones y fallos. USD por resultado con calidad = costo de todos los intentos
        comparables / resultados que pasaron el mínimo. Una ruta que no termina no compite como «más
        barata».
      </li>
      <li>
        <b>Comparar calidad, costo y tiempo.</b> Sólo entre rutas del mismo contrato/protocolo. Si
        los intervalos de costo se solapan, no hay ganador económico único. El tiempo se observa
        incluyendo checks; caché, orden y carga del host impiden atribuir toda diferencia al modelo.
      </li>
      <li>
        <b>Decidir cuánto sabemos.</b> Candidato de laboratorio: sólo checks. Candidato de piloto:
        mínimo de calidad con pocas muestras. Ruta repetida: al menos tres casos comparables por
        alternativa viable y aceptación observada mínima de 80%. Es una regla de admisión, no una
        garantía estadística.
      </li>
    </ol>
    <h3>Qué significa cada combinación</h3>
    <p>
      «Solo» identifica al ejecutor, no elimina la revisión. En las recetas nuevas,
      <b>Haiku solo + revisión común Sonnet</b> significa Haiku implementa y otra sesión Sonnet
      revisa. <b>Sonnet → Haiku + revisión común Sonnet</b> añade planificación Sonnet antes de
      ejecutar Haiku. <b>Opus → Sonnet → Haiku</b> separa arquitectura, plan técnico y ejecución,
      además de la revisión. Cada fase se factura en la suma; más agentes no implican mejor
      resultado.
    </p>
    <h3>Propuesta de política para el RAG</h3>
    <ul>
      <li>
        Filtrar primero proveedores autorizados, login, modelos/esfuerzos disponibles, permisos y
        rol.
      </li>
      <li>
        Recuperar casos locales del mismo tipo de tarea, contrato, complejidad, riesgo,
        proveedor/modelo/esfuerzo y receta completa. Recuperación y selección numérica no llaman a
        un modelo.
      </li>
      <li>
        Tarea simple y acotada: probar ejecución directa ligera con checks si existe evidencia para
        ese alcance. Comparar con ejecutar en el modelo actual para evitar delegación innecesaria.
      </li>
      <li>
        Tarea con planificación: comparar ejecución directa con planificador + ejecutor + revisión.
        El ejecutor se elige por calidad y costo del flujo; no se fija siempre Haiku.
      </li>
      <li>
        Complejidad/riesgo altos: exigir planificación adecuada y checks más fuertes. Escalar a Opus
        u otro modelo avanzado si la evidencia o el análisis lo justifica, sin dar por ganada una
        triple combinación.
      </li>
      <li>
        Sin evidencia suficiente: usar la política conservadora configurada y proponer un
        experimento. No aprender éxitos sólo de tests antiguos ni activar una ruta económica por una
        muestra.
      </li>
    </ul>
    <p>
      <b>Estado real:</b> el motor existente recibe metadatos de dificultad/riesgo y aplica reglas y
      casos; estas pruebas fijaron las recetas experimentalmente. No demuestran selección autónoma
      óptima ni equivalencia universal de calidad. Esta metodología delimita qué evidencia falta
      antes de promover recomendaciones.
    </p>
    <p>
      Exportaciones de decisiones: <a href="decisiones.json">conclusiones por tarea</a> ·
      <a href="metodologia.json">criterios de evaluación</a>. Las mediciones originales siguen en la
      tabla única y CSV.
    </p>
  </section>`;
}
