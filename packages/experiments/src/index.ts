export {migrateLegacyReport, importLegacyFile, inferOperation} from './legacy-import.js';
export {materializeAndRouteTasks, type TaskDraft} from './designed-backlog.js';
export {runFactorialCampaign, runHierarchicalTrial, escalationReasons,
  type CampaignPorts, type HierarchicalPorts, type PhaseInput, type PhaseOutput, type FactorialCampaignSpec} from './campaign-runner.js';
export {
  freezeHandoff, validateFrozenHandoff, randomizeCells, scheduleStories, allocateSharedDesign,
  stableRolePrompt, executeFrozenHandoff, type FrozenHandoff, type FrozenExecutor, type ExperimentStory,
} from './protocol.js';
