export type WorkClass =
  | "init"
  | "plan"
  | "feature"
  | "bug"
  | "review"
  | "verify"
  | "retro"
  | "documentation"
  | "infrastructure"
  | "research";

export interface WorkflowRequest {
  readonly workClass: WorkClass;
  readonly ambiguity: "low" | "high";
  readonly complexity: "small" | "normal" | "multi-session";
  readonly reproducibility: "confirmed" | "missing" | "intermittent" | "not-applicable";
}

export interface WorkflowResult {
  readonly selectedSkill: SkillName;
  readonly why: string;
  readonly rejectedSkills: readonly SkillName[];
}

export interface SkillDescriptor {
  readonly name: SkillName;
  readonly relativePath: `skills/${string}/SKILL.md`;
  readonly purpose: string;
  readonly userInvocable: boolean;
}

export type SkillName =
  | "vpr-init"
  | "vpr-plan"
  | "vpr-feature"
  | "vpr-grill"
  | "vpr-bugfix"
  | "vpr-diagnose"
  | "vpr-verify"
  | "vpr-review"
  | "vpr-retro";

export const skillRegistry: readonly SkillDescriptor[] = [
  skill("vpr-init", "Detectar y proponer un perfil sin sobrescrituras"),
  skill("vpr-plan", "Descomponer una Story en Tasks verticales"),
  skill("vpr-feature", "Implementar una funcionalidad ya clara"),
  skill("vpr-grill", "Aclarar una funcionalidad ambigua y producir StoryDraft/StoryPatch"),
  skill("vpr-bugfix", "Corregir un bug reproducido con regresión"),
  skill("vpr-diagnose", "Construir una reproducción y falsar hipótesis"),
  skill("vpr-verify", "Ejecutar checks y reunir evidencia vigente"),
  skill("vpr-review", "Revisar diff contra aceptación y estándares"),
  skill("vpr-retro", "Proponer mejoras del sistema sin autoaplicarlas")
];

export function selectWorkflow(request: WorkflowRequest): WorkflowResult {
  let selectedSkill: SkillName;
  let why: string;

  switch (request.workClass) {
    case "init":
      selectedSkill = "vpr-init";
      why = "La solicitud inicializa o perfila un repositorio.";
      break;
    case "plan":
    case "research":
      selectedSkill = "vpr-plan";
      why = "La solicitud necesita decisiones o Tasks antes de ejecutar.";
      break;
    case "feature":
      if (request.ambiguity === "high" || request.complexity === "multi-session") {
        selectedSkill = "vpr-grill";
        why = "La funcionalidad es ambigua o supera una sesion; primero se aclara la Story.";
      } else {
        selectedSkill = "vpr-feature";
        why = "La funcionalidad tiene alcance claro y cabe en la ruta ligera.";
      }
      break;
    case "bug":
      if (
        request.reproducibility === "missing" ||
        request.reproducibility === "intermittent" ||
        request.ambiguity === "high"
      ) {
        selectedSkill = "vpr-diagnose";
        why = "El bug no tiene una reproduccion determinista o conserva incertidumbre.";
      } else {
        selectedSkill = "vpr-bugfix";
        why = "El bug ya se reproduce y admite una regresion directa.";
      }
      break;
    case "review":
      selectedSkill = "vpr-review";
      why = "La solicitud es una revision del cambio real.";
      break;
    case "verify":
      selectedSkill = "vpr-verify";
      why = "La solicitud pide evidencia de checks, no implementacion.";
      break;
    case "retro":
      selectedSkill = "vpr-retro";
      why = "La solicitud busca mejorar el sistema despues de un hito.";
      break;
    case "documentation":
    case "infrastructure":
      selectedSkill = "vpr-feature";
      why = "El cambio claro usa la ruta ligera y puede marcar TDD como no aplicable.";
      break;
  }

  return {
    selectedSkill,
    why,
    rejectedSkills: skillRegistry
      .map((descriptor) => descriptor.name)
      .filter((name) => name !== selectedSkill)
  };
}

function skill(name: SkillName, purpose: string): SkillDescriptor {
  return {
    name,
    relativePath: `skills/${name}/SKILL.md`,
    purpose,
    userInvocable: true
  };
}

