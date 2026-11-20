export {migrateLegacyReport, importLegacyFile, inferOperation} from './legacy-import.js';
export {analyzeFactorialEffects, analyzeExplorationPairs, type ControlledPair} from './controlled-effects.js';
export {createIsolatedWorkspaceFactory} from './isolated-workspace.js';
export {createNativeCampaignPorts} from './native-campaign.js';
export {writeExperimentReport} from './report-builder.js';
export {priceEvidenceCalls} from './call-pricing.js';
export {proposeCampaign} from './campaign-plan.js';
export {analyzeEvidence, type EvidenceAnalysis} from './evidence-analysis.js';
export {renderEvidenceReport} from './evidence-report.js';
export {materializeAndRouteTasks, type TaskDraft} from './designed-backlog.js';
export {runFactorialCampaign, runHierarchicalTrial, escalationReasons,
  type CampaignPorts, type HierarchicalPorts, type PhaseInput, type PhaseOutput, type FactorialCampaignSpec} from './campaign-runner.js';
export {
  freezeHandoff, validateFrozenHandoff, randomizeCells, scheduleStories, allocateSharedDesign,
  stableRolePrompt, executeFrozenHandoff, type FrozenHandoff, type FrozenExecutor, type ExperimentStory,
} from './protocol.js';
