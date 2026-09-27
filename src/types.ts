export type DifferenceStatus = 'same' | 'changed' | 'added' | 'removed' | 'misaligned';
export type WitnessKey = 'base' | 'referenceA' | 'referenceB';
export type ReadingPattern = 'unanimous' | 'majority' | 'divergent';

export interface TextUnit {
  id: string;
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

export interface ThreeWaySimilarities {
  baseReferenceA: number | null;
  baseReferenceB: number | null;
  referenceAReferenceB: number | null;
}

export interface AlignmentRow {
  id: string;
  base?: TextUnit;
  referenceA?: TextUnit;
  referenceB?: TextUnit;
  status: DifferenceStatus;
  pattern: ReadingPattern;
  similarity: number;
  similarities: ThreeWaySimilarities;
  majorityReaders: WitnessKey[];
  singletonReaders: WitnessKey[];
  missingReaders: WitnessKey[];
  note: string;
  source: string;
  accepted: boolean;
  manuallyAdjusted: boolean;
  manuallyConfirmed: boolean;
  adoptedSource?: WitnessKey;
  adoptedText?: string;
}

export interface ComparisonRules {
  ignorePunctuation: boolean;
  ignoreVariants: boolean;
  candidateWindow: number;
}

export interface PersistedCollationState {
  versions: VersionDocument[];
  baseVersionId: string;
  referenceAId: string;
  referenceBId: string;
  rows: AlignmentRow[];
  rules: ComparisonRules;
  selectedRowId: string;
}
