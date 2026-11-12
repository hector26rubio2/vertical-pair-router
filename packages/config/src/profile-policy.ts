import type { PolicyLayer, PolicyRules } from "@vpr/contracts";

import type { ProjectProfileV1 } from "./project-profile.js";

export interface GlobalProfileV1 {
  readonly schemaVersion: 1;
  readonly protectedPolicy: PolicyRules;
  readonly defaults: PolicyRules;
}

export class UnsupportedProfileVersionError extends Error {
  public constructor(kind: string, version: unknown) {
    super(`Unsupported ${kind} profile schemaVersion: ${String(version)}`);
    this.name = "UnsupportedProfileVersionError";
  }
}

export function parseGlobalProfile(value: unknown): GlobalProfileV1 {
  const record = requireRecord(value, "global");
  requireVersion(record, "global");
  return {
    schemaVersion: 1,
    protectedPolicy: parsePolicy(record.protectedPolicy),
    defaults: parsePolicy(record.defaults)
  };
}

export function parseProjectProfile(value: unknown): ProjectProfileV1 {
  const record = requireRecord(value, "project");
  requireVersion(record, "project");
  if (
    typeof record.projectId !== "string" ||
    !record.projectId.startsWith("project_") ||
    typeof record.name !== "string" ||
    typeof record.packageManager !== "string" ||
    !["pnpm", "npm", "yarn", "unknown"].includes(record.packageManager) ||
    !isRecord(record.checks) ||
    typeof record.glossaryPath !== "string"
  ) {
    throw new TypeError("Invalid project profile fields");
  }
  for (const command of Object.values(record.checks)) {
    if (
      !isRecord(command) ||
      typeof command.program !== "string" ||
      !Array.isArray(command.args) ||
      !command.args.every((arg) => typeof arg === "string")
    ) {
      throw new TypeError("Invalid project check command");
    }
  }
  if (record.setup !== undefined && (
    !isRecord(record.setup) || !Array.isArray(record.setup.technologies) ||
    !record.setup.technologies.every(item => typeof item === 'string') ||
    !isRecord(record.setup.integrations) ||
    !['husky', 'graphify', 'archify'].every(key => typeof (record.setup as { integrations: Record<string, unknown> }).integrations[key] === 'boolean')
  )) throw new TypeError('Invalid project setup');
  if (record.orchestration !== undefined) validateOrchestration(record.orchestration);
  if (record.subscriptions !== undefined && (!Array.isArray(record.subscriptions) || record.subscriptions.some(item =>
    !isRecord(item) || !['claude', 'codex', 'copilot'].includes(String(item.provider)) ||
    typeof item.planId !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(item.planId) ||
    !['user_reported', 'provider_reported'].includes(String(item.source))))) throw new TypeError('Invalid subscription configuration');
  return {
    schemaVersion: 1,
    projectId: record.projectId as ProjectProfileV1["projectId"],
    name: record.name,
    packageManager: record.packageManager as ProjectProfileV1["packageManager"],
    checks: record.checks as ProjectProfileV1["checks"],
    glossaryPath: record.glossaryPath,
    policy: parsePolicy(record.policy),
    ...(record.subscriptions === undefined ? {} : { subscriptions: record.subscriptions as NonNullable<ProjectProfileV1['subscriptions']> }),
    ...(record.orchestration === undefined ? {} : { orchestration: record.orchestration as unknown as NonNullable<ProjectProfileV1['orchestration']> }),
    ...(record.setup === undefined ? {} : { setup: record.setup as unknown as NonNullable<ProjectProfileV1['setup']> })
  };
}

function validateOrchestration(value: unknown): void {
  if (!isRecord(value) || typeof value.orchestratorId !== 'string' ||
      !Number.isInteger(value.maxWorkers) || (value.maxWorkers as number) < 1 || (value.maxWorkers as number) > 2 ||
      typeof value.allowLightCoding !== 'boolean' || !Array.isArray(value.models)) throw new TypeError('Invalid orchestration profile');
  if (value.objective !== undefined && !['tokens', 'reference-cost', 'subscription-quota'].includes(String(value.objective))) throw new TypeError('Invalid routing objective');
  const ids = new Set<string>();
  for (const model of value.models) {
    if (!isRecord(model) || typeof model.id !== 'string' || ids.has(model.id) ||
      !['claude', 'codex', 'copilot'].includes(String(model.provider)) || typeof model.model !== 'string' ||
      !/^[\w./:-]+$/u.test(model.model) || !['light', 'standard', 'high'].includes(String(model.tier)) ||
      (model.effort !== undefined && !['low', 'medium', 'high'].includes(String(model.effort))) ||
      !Array.isArray(model.roles) || !model.roles.every(role => ['orchestrator', 'inventory', 'coding', 'review'].includes(String(role)))) throw new TypeError('Invalid agent model');
    ids.add(model.id);
  }
  if (!ids.has(value.orchestratorId)) throw new TypeError('Configured orchestrator is absent from model catalog');
}

export function profilePolicyLayers(
  global: GlobalProfileV1,
  project: ProjectProfileV1
): readonly PolicyLayer[] {
  return [
    { id: "global.protectedPolicy", kind: "protected-user", rules: global.protectedPolicy },
    { id: "global.defaults", kind: "global", rules: global.defaults },
    { id: `${project.projectId}.policy`, kind: "project", rules: project.policy }
  ];
}

function requireRecord(value: unknown, kind: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Invalid ${kind} profile`);
  return value;
}

function requireVersion(record: Record<string, unknown>, kind: string): void {
  if (record.schemaVersion !== 1) {
    throw new UnsupportedProfileVersionError(kind, record.schemaVersion);
  }
}

function parsePolicy(value: unknown): PolicyRules {
  if (!isRecord(value)) throw new TypeError("Invalid policy rules");
  const policy: PolicyRules = {};
  if (value.allowShell !== undefined) {
    if (typeof value.allowShell !== "boolean") throw new TypeError("Invalid allowShell");
    Object.assign(policy, { allowShell: value.allowShell });
  }
  if (value.allowNetworkTelemetry !== undefined) {
    if (typeof value.allowNetworkTelemetry !== "boolean") {
      throw new TypeError("Invalid allowNetworkTelemetry");
    }
    Object.assign(policy, { allowNetworkTelemetry: value.allowNetworkTelemetry });
  }
  if (value.allowedProviders !== undefined) {
    if (
      !Array.isArray(value.allowedProviders) ||
      !value.allowedProviders.every((provider) => typeof provider === "string")
    ) {
      throw new TypeError("Invalid allowedProviders");
    }
    Object.assign(policy, { allowedProviders: [...value.allowedProviders] });
  }
  if (value.maxOutputBytes !== undefined) {
    if (!Number.isSafeInteger(value.maxOutputBytes) || Number(value.maxOutputBytes) <= 0) {
      throw new TypeError("Invalid maxOutputBytes");
    }
    Object.assign(policy, { maxOutputBytes: Number(value.maxOutputBytes) });
  }
  return policy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

