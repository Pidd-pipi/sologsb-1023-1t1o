export type DifferenceStatus = 'same' | 'changed' | 'missing' | 'misaligned';

export type WitnessKey = 'base' | 'reference1' | 'reference2';

export type ReadingPattern = 'unanimous' | 'majority' | 'divergent' | 'incomplete';

export type WitnessVersionIds = Record<WitnessKey, string>;

export interface TextUnit {
  id: string;
  versionId: string;
  paragraphId: string;
  paragraphOrder: number;
  sentenceOrder: number;
  paragraphText: string;
  text: string;
}

export interface VersionDocument {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  text: string;
  units: TextUnit[];
}

export interface AlignmentRow {
  id: string;
  base?: TextUnit;
  reference1?: TextUnit;
  reference2?: TextUnit;
  witnessVersionIds: WitnessVersionIds;
  status: DifferenceStatus;
  readingPattern: ReadingPattern;
  pairSimilarities: Partial<{
    baseReference1: number;
    baseReference2: number;
    reference1Reference2: number;
  }>;
  similarity: number;
  agreementVersionIds: string[];
  singletonVersionId?: string;
  missingVersionIds: string[];
  adoptedVersionId?: string;
  manualConfirmed: boolean;
  note: string;
  source: string;
  accepted: boolean;
  manuallyAdjusted: boolean;
}

export interface ComparisonRules {
  ignorePunctuation: boolean;
  ignoreVariants: boolean;
  candidateWindow: number;
}

export interface PersistedCollationState {
  schemaVersion: 2;
  versions: VersionDocument[];
  baseVersionId: string;
  reference1VersionId: string;
  reference2VersionId: string;
  rows: AlignmentRow[];
  rules: ComparisonRules;
  selectedRowId: string;
}
