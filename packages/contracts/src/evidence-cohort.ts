import type {WorkFeatures} from './experiment-contracts.js';

export interface EvidenceCohort {
  readonly protocol: string | null;
  readonly acceptanceContractHash: string | null;
  readonly features: WorkFeatures;
}
const featureKeys = ['kind', 'role', 'designComplexity', 'executionComplexity', 'risk',
  'publicApi', 'persistence', 'transactions', 'security', 'money'] as const;

/** Missing safety signals cannot establish comparability. Filenames alone do not define a contract. */
export function isComparableEvidence(left: EvidenceCohort, right: EvidenceCohort): boolean {
  if (!left.protocol || !left.acceptanceContractHash) return false;
  if (left.protocol !== right.protocol || left.acceptanceContractHash !== right.acceptanceContractHash) return false;
  return featureKeys.every(key => left.features[key] !== null && left.features[key] === right.features[key]);
}
