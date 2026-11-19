const selector = document.getElementById("panel-task");
selector.addEventListener("change", (event) => {
  const id = event.target.value;
  for (const panel of document.querySelectorAll("[data-task-panel]"))
    panel.hidden = Boolean(id && panel.dataset.taskPanel !== id);
  const filter = document.getElementById("task-filter");
  filter.value = id;
  filter.dispatchEvent(new Event("change"));
});
const initial = location.hash.match(/^#case-(.+)$/)?.[1]?.toUpperCase();
if (initial && [...selector.options].some((o) => o.value === initial)) selector.value = initial;
else
  for (const id of ["F02", "F01B", "F01"])
    if ([...selector.options].some((o) => o.value === id)) {
      selector.value = id;
      break;
    }
selector.dispatchEvent(new Event("change"));
for (const allocation of document.querySelectorAll(".allocation-selector"))
  allocation.addEventListener("change", (event) => {
    for (const chart of document.querySelectorAll("[data-cost-allocation]"))
      if (chart.dataset.task === allocation.dataset.task)
        chart.hidden = chart.dataset.index !== event.target.value;
  });
window.addEventListener("hashchange", () => {
  const match = location.hash.match(/^#case-(.+)$/);
  const id = match?.[1]?.toUpperCase();
  if (id && [...selector.options].some((o) => o.value === id)) {
    selector.value = id;
    selector.dispatchEvent(new Event("change"));
  }
});
document.querySelector('a[href="#ledger"]').addEventListener("click", () => {
  document.getElementById("ledger").open = true;
});
