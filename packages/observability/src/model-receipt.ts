export function verifyModelReceipt(requestedModel: string, observedModels: readonly string[]): {
  readonly status: 'confirmed' | 'substituted' | 'unavailable';
  readonly requestedModel: string;
  readonly observedModels: readonly string[];
} {
  const requested = requestedModel.toLowerCase();
  const observations = [...new Set(observedModels.filter(Boolean))];
  const claudeAliases = ['haiku', 'sonnet', 'opus', 'fable'];
  const matches = (observed: string): boolean => claudeAliases.includes(requested)
    ? new RegExp(`(?:^|[-/])${requested}(?:[-/]|$)`, 'u').test(observed.toLowerCase())
    : requested === observed.toLowerCase();
  return { status: observations.length === 0 ? 'unavailable' : observations.every(matches) ? 'confirmed' : 'substituted', requestedModel, observedModels: observations };
}
