export type FundingSourceType = 'regulated_vasp' | 'self_custody';
export type KytOutcome = 'PENDING_KYT' | 'CLEARED' | 'QUARANTINED';

export type KytAssessmentInput = {
  sourceType: FundingSourceType;
  riskScore: number;
  sanctionsMatch?: boolean;
  travelRuleOriginatorCaptured?: boolean;
  sourceOfFundsTraced?: boolean;
  amountUsd: number;
  selfCustodyStagedLimitUsd: number;
};

export type KytAssessment = {
  outcome: KytOutcome;
  policy: 'STANDARD' | 'ENHANCED';
  reasons: string[];
};

export function assessKyt(input: KytAssessmentInput): KytAssessment {
  const policy = input.sourceType === 'regulated_vasp' ? 'STANDARD' : 'ENHANCED';
  if (input.sanctionsMatch || input.riskScore >= 80) {
    return {
      outcome: 'QUARANTINED',
      policy,
      reasons: [input.sanctionsMatch ? 'Sanctions match' : 'KYT risk score exceeds quarantine threshold'],
    };
  }

  const reasons: string[] = [];
  if (input.sourceType === 'regulated_vasp' && !input.travelRuleOriginatorCaptured) {
    reasons.push('Travel Rule originator data is required');
  }
  if (input.sourceType === 'self_custody') {
    if (!input.sourceOfFundsTraced) reasons.push('Source-of-funds provenance is not cleared');
    if (input.amountUsd > input.selfCustodyStagedLimitUsd) reasons.push('Staged self-custody deposit limit exceeded');
  }

  return {
    outcome: reasons.length > 0 ? 'PENDING_KYT' : 'CLEARED',
    policy,
    reasons,
  };
}
