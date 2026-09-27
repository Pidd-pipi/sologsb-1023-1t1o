import { computed, onMounted, ref, watch } from 'vue';
import { sampleVersions, splitIntoUnits } from '../data';
import type {
  AlignmentRow,
  ComparisonRules,
  DifferenceStatus,
  PersistedCollationState,
  ReadingPattern,
  TextUnit,
  VersionDocument,
  WitnessKey
} from '../types';

const STORAGE_KEY = 'sologsb-1023/multi-version-collation/v2';
const LEGACY_STORAGE_KEY = 'sologsb-1023/multi-version-collation/v1';

const witnessKeys: WitnessKey[] = ['base', 'referenceA', 'referenceB'];
const witnessPriority: WitnessKey[] = ['base', 'referenceA', 'referenceB'];

const variantMap: Record<string, string> = {
  為: '为',
  爲: '为',
  識: '识',
  強: '强',
  與: '与',
  猶: '犹',
  鄰: '邻',
  儼: '俨',
  渙: '涣',
  將: '将',
  樸: '朴',
  曠: '旷',
  濁: '浊',
  靜: '静',
  動: '动',
  玅: '妙',
  裏: '里',
  裡: '里',
  說: '说',
  國: '国'
};

interface PairStep {
  left?: TextUnit;
  right?: TextUnit;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function normalized(value: string, rules: ComparisonRules) {
  let result = value.toLocaleLowerCase().trim();
  if (rules.ignoreVariants) {
    result = Array.from(result, (character) => variantMap[character] ?? character).join('');
  }
  if (rules.ignorePunctuation) {
    result = result.replace(/[\s，。！？；：、“”‘’「」『』（）()《》〈〉·,.!?;:'"[\]{}<>—\-…]/g, '');
  }
  return result;
}

function similarity(left: string, right: string) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(previous[j], previous[j - 1]);
      diagonal = old;
    }
  }
  return previous[b.length] / Math.max(a.length, b.length);
}

function pairStatus(left: TextUnit | undefined, right: TextUnit | undefined, ratio: number): DifferenceStatus {
  if (!left) return 'added';
  if (!right) return 'removed';
  if (ratio > 0.995) return 'same';
  if (ratio >= 0.38) return 'changed';
  return 'misaligned';
}

async function alignPair(
  leftUnits: TextUnit[],
  rightUnits: TextUnit[],
  rules: ComparisonRules,
  onProgress: (value: number) => void
): Promise<PairStep[]> {
  const steps: PairStep[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftUnits.length || rightIndex < rightUnits.length) {
    const left = leftUnits[leftIndex];
    const right = rightUnits[rightIndex];

    if (!left) {
      steps.push({ right });
      rightIndex += 1;
    } else if (!right) {
      steps.push({ left });
      leftIndex += 1;
    } else {
      const sameParagraph =
        left.paragraphOrder === right.paragraphOrder || Math.abs(left.paragraphOrder - right.paragraphOrder) <= 1;
      const ratio = similarity(normalized(left.text, rules), normalized(right.text, rules));
      const nextLeftRatio =
        leftUnits[leftIndex + 1] && right
          ? similarity(normalized(leftUnits[leftIndex + 1].text, rules), normalized(right.text, rules))
          : 0;
      const nextRightRatio =
        rightUnits[rightIndex + 1] && left
          ? similarity(normalized(left.text, rules), normalized(rightUnits[rightIndex + 1].text, rules))
          : 0;

      if (sameParagraph && (ratio >= 0.28 || (nextLeftRatio < 0.58 && nextRightRatio < 0.58))) {
        steps.push({ left, right });
        leftIndex += 1;
        rightIndex += 1;
      } else if (nextRightRatio > ratio && nextRightRatio > nextLeftRatio) {
        steps.push({ right });
        rightIndex += 1;
      } else {
        steps.push({ left });
        leftIndex += 1;
      }
    }

    if (steps.length % 24 === 0) {
      onProgress(Math.round(((leftIndex + rightIndex) / Math.max(1, leftUnits.length + rightUnits.length)) * 100));
      await yieldToBrowser();
    }
  }
  onProgress(100);
  return steps;
}

function indexPairSteps(steps: PairStep[]) {
  const rowsByLeft = new Map<number, number>();
  const insertionsByGap: number[][] = [];
  let gapIndex = 0;

  steps.forEach((step, rowIndex) => {
    if (step.left) {
      rowsByLeft.set(step.left.sentenceOrder - 1, rowIndex);
      gapIndex = step.left.sentenceOrder;
    } else if (step.right) {
      if (!insertionsByGap[gapIndex]) insertionsByGap[gapIndex] = [];
      insertionsByGap[gapIndex].push(rowIndex);
    }
  });

  return { rowsByLeft, insertionsByGap };
}

function ratioFor(row: Pick<AlignmentRow, 'base' | 'referenceA' | 'referenceB'>, rules: ComparisonRules) {
  const values: Record<WitnessKey, string | undefined> = {
    base: row.base ? normalized(row.base.text, rules) : undefined,
    referenceA: row.referenceA ? normalized(row.referenceA.text, rules) : undefined,
    referenceB: row.referenceB ? normalized(row.referenceB.text, rules) : undefined
  };
  const ratio = (a: WitnessKey, b: WitnessKey) =>
    values[a] !== undefined && values[b] !== undefined ? similarity(values[a]!, values[b]!) : null;
  const baseReferenceA = ratio('base', 'referenceA');
  const baseReferenceB = ratio('base', 'referenceB');
  const referenceAReferenceB = ratio('referenceA', 'referenceB');
  const pairRatios = [baseReferenceA, baseReferenceB, referenceAReferenceB].filter(
    (value): value is number => value !== null
  );

  const present = witnessKeys.filter((key) => values[key] !== undefined);
  const groups = new Map<string, WitnessKey[]>();
  present.forEach((key) => {
    const reading = values[key]!;
    const group = groups.get(reading) ?? [];
    group.push(key);
    groups.set(reading, group);
  });

  const largestGroup = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const hasMajority = largestGroup.length >= 2;
  const missingReaders = witnessKeys.filter((key) => values[key] === undefined);
  const majorityReaders = hasMajority ? largestGroup : [];
  const singletonReaders = hasMajority ? present.filter((key) => !majorityReaders.includes(key)) : [];
  let pattern: ReadingPattern = 'divergent';
  if (present.length === 3 && largestGroup.length === 3) {
    pattern = 'unanimous';
  } else if (hasMajority) {
    pattern = 'majority';
  }

  let status: DifferenceStatus;
  const maxRatio = pairRatios.length ? Math.max(...pairRatios) : 0;
  if (present.length >= 2 && maxRatio < 0.38) {
    status = 'misaligned';
  } else if (!values.base) {
    status = 'added';
  } else if (missingReaders.length > 0) {
    status = 'removed';
  } else if (pattern === 'unanimous') {
    status = 'same';
  } else {
    status = 'changed';
  }

  const adoptedSource =
    pattern === 'unanimous' || pattern === 'majority'
      ? witnessPriority.find((key) => majorityReaders.includes(key))
      : undefined;

  return {
    pattern,
    status,
    similarity: pairRatios.length ? Number((pairRatios.reduce((sum, value) => sum + value, 0) / pairRatios.length).toFixed(3)) : 0,
    similarities: {
      baseReferenceA: baseReferenceA === null ? null : Number(baseReferenceA.toFixed(3)),
      baseReferenceB: baseReferenceB === null ? null : Number(baseReferenceB.toFixed(3)),
      referenceAReferenceB: referenceAReferenceB === null ? null : Number(referenceAReferenceB.toFixed(3))
    },
    majorityReaders,
    singletonReaders,
    missingReaders,
    adoptedSource,
    adoptedText: adoptedSource ? row[adoptedSource]?.text : undefined
  };
}

function withAnalysis(row: AlignmentRow, rules: ComparisonRules, preserveDecision = false): AlignmentRow {
  const analysis = ratioFor(row, rules);
  if (preserveDecision) {
    const adoptedSource = row.adoptedSource ?? analysis.adoptedSource;
    const adoptedRequiresConfirmation =
      analysis.pattern === 'divergent' ||
      (adoptedSource !== undefined && analysis.singletonReaders.includes(adoptedSource));
    const needsConfirmation = analysis.pattern !== 'unanimous' && adoptedRequiresConfirmation;
    return {
      ...row,
      ...analysis,
      status: row.manuallyAdjusted ? row.status : analysis.status,
      adoptedSource,
      adoptedText: adoptedSource ? row[adoptedSource]?.text : analysis.adoptedText,
      accepted: Boolean(row.accepted && !needsConfirmation),
      manuallyConfirmed: Boolean(row.manuallyConfirmed && !needsConfirmation)
    };
  }

  const unanimous = analysis.pattern === 'unanimous';
  return {
    ...row,
    ...analysis,
    status: analysis.status,
    accepted: unanimous,
    manuallyConfirmed: false
  };
}

function makeThreeWayRow(
  id: string,
  units: Partial<Record<WitnessKey, TextUnit>>,
  rules: ComparisonRules
): AlignmentRow {
  return withAnalysis(
    {
      id,
      base: units.base,
      referenceA: units.referenceA,
      referenceB: units.referenceB,
      status: 'changed',
      pattern: 'divergent',
      similarity: 0,
      similarities: {
        baseReferenceA: null,
        baseReferenceB: null,
        referenceAReferenceB: null
      },
      majorityReaders: [],
      singletonReaders: [],
      missingReaders: [],
      note: '',
      source: '',
      accepted: false,
      manuallyAdjusted: false,
      manuallyConfirmed: false
    },
    rules
  );
}

async function alignThreeWays(
  baseUnits: TextUnit[],
  referenceAUnits: TextUnit[],
  referenceBUnits: TextUnit[],
  rules: ComparisonRules,
  onProgress: (value: number) => void
): Promise<AlignmentRow[]> {
  const [stepsA, stepsB] = await Promise.all([
    alignPair(baseUnits, referenceAUnits, rules, (value) => onProgress(Math.round(value * 0.48))),
    (async () => {
      await yieldToBrowser();
      return alignPair(baseUnits, referenceBUnits, rules, (value) => onProgress(48 + Math.round(value * 0.48)));
    })()
  ]);

  const indexA = indexPairSteps(stepsA);
  const indexB = indexPairSteps(stepsB);
  const rows: AlignmentRow[] = [];

  const insertGap = (gap: number) => {
    const aRows = indexA.insertionsByGap[gap] ?? [];
    const bRows = indexB.insertionsByGap[gap] ?? [];
    const count = Math.max(aRows.length, bRows.length);
    for (let i = 0; i < count; i += 1) {
      const rowA = aRows[i];
      const rowB = bRows[i];
      rows.push(
        makeThreeWayRow(
          `row-gap-${gap}-${i + 1}`,
          {
            referenceA: rowA === undefined ? undefined : stepsA[rowA]?.right,
            referenceB: rowB === undefined ? undefined : stepsB[rowB]?.right
          },
          rules
        )
      );
    }
  };

  insertGap(0);
  baseUnits.forEach((base, baseIndex) => {
    const rowA = indexA.rowsByLeft.get(baseIndex);
    const rowB = indexB.rowsByLeft.get(baseIndex);
    rows.push(
      makeThreeWayRow(
        `row-${baseIndex + 1}`,
        {
          base,
          referenceA: rowA === undefined ? undefined : stepsA[rowA]?.right,
          referenceB: rowB === undefined ? undefined : stepsB[rowB]?.right
        },
        rules
      )
    );
    insertGap(baseIndex + 1);
  });

  onProgress(100);
  return rows;
}

function defaultRules(): ComparisonRules {
  return { ignorePunctuation: true, ignoreVariants: true, candidateWindow: 3 };
}

function migrateLegacyState(raw: string): PersistedCollationState | null {
  try {
    const parsed = JSON.parse(raw) as {
      versions: VersionDocument[];
      leftVersionId?: string;
      rightVersionId?: string;
      baseVersionId?: string;
      referenceAId?: string;
      referenceBId?: string;
      rows: AlignmentRow[];
      rules: ComparisonRules;
      selectedRowId?: string;
    };
    const ids = parsed.versions?.map((version) => version.id) ?? [];
    const baseVersionId = parsed.baseVersionId ?? parsed.leftVersionId ?? ids[0] ?? '';
    const referenceAId = parsed.referenceAId ?? parsed.rightVersionId ?? ids.find((id) => id !== baseVersionId) ?? '';
    const referenceBId = ids.find((id) => id !== baseVersionId && id !== referenceAId) ?? '';
    const rows = (parsed.rows ?? []).map((row) => {
      const migrated = row as AlignmentRow & { left?: TextUnit; right?: TextUnit };
      return {
        ...migrated,
        base: migrated.base ?? migrated.left,
        referenceA: migrated.referenceA ?? migrated.right,
        referenceB: migrated.referenceB,
        pattern: migrated.pattern ?? 'divergent',
        similarities: migrated.similarities ?? {
          baseReferenceA: migrated.similarity ?? null,
          baseReferenceB: null,
          referenceAReferenceB: null
        },
        majorityReaders: migrated.majorityReaders ?? [],
        singletonReaders: migrated.singletonReaders ?? [],
        missingReaders: migrated.missingReaders ?? [],
        manuallyConfirmed: migrated.manuallyConfirmed ?? migrated.accepted ?? false,
        adoptedSource: migrated.adoptedSource,
        adoptedText: migrated.adoptedText
      } as AlignmentRow;
    });
    return {
      versions: parsed.versions ?? [],
      baseVersionId,
      referenceAId,
      referenceBId,
      rows,
      rules: parsed.rules ?? defaultRules(),
      selectedRowId: parsed.selectedRowId ?? ''
    };
  } catch {
    return null;
  }
}

export function useCollation() {
  const versions = ref<VersionDocument[]>(clone(sampleVersions));
  const baseVersionId = ref(versions.value[0].id);
  const referenceAId = ref(versions.value[1]?.id ?? '');
  const referenceBId = ref(versions.value[2]?.id ?? '');
  const rows = ref<AlignmentRow[]>([]);
  const rules = ref<ComparisonRules>(defaultRules());
  const selectedRowId = ref('');
  const selectedRowIds = ref<(string | number)[]>([]);
  const processing = ref(false);
  const progress = ref(0);
  const message = ref('正在载入本地校勘数据…');
  const history = ref<string[]>([]);
  const future = ref<string[]>([]);
  const canUndo = computed(() => history.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);
  const baseVersion = computed(() => versions.value.find((item) => item.id === baseVersionId.value));
  const referenceAVersion = computed(() => versions.value.find((item) => item.id === referenceAId.value));
  const referenceBVersion = computed(() => versions.value.find((item) => item.id === referenceBId.value));
  const canAlign = computed(
    () =>
      Boolean(baseVersion.value && referenceAVersion.value && referenceBVersion.value) &&
      new Set([baseVersionId.value, referenceAId.value, referenceBId.value]).size === 3 &&
      !processing.value
  );
  const selectedRow = computed(() => rows.value.find((item) => item.id === selectedRowId.value));
  const differenceCount = computed(() => rows.value.filter((row) => row.pattern !== 'unanimous').length);
  const missingCount = computed(() => rows.value.filter((row) => row.missingReaders.length > 0).length);
  const singletonCount = computed(() => rows.value.filter((row) => row.singletonReaders.length > 0).length);
  const acceptedCount = computed(() => rows.value.filter((row) => row.accepted).length);
  const unresolvedCount = computed(() => rows.value.filter((row) => !row.accepted && row.pattern !== 'unanimous').length);

  function snapshot(): string {
    const data: PersistedCollationState = {
      versions: versions.value,
      baseVersionId: baseVersionId.value,
      referenceAId: referenceAId.value,
      referenceBId: referenceBId.value,
      rows: rows.value,
      rules: rules.value,
      selectedRowId: selectedRowId.value
    };
    return JSON.stringify(data);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, snapshot());
  }

  function commit(label: string, mutate: () => void) {
    history.value.push(snapshot());
    if (history.value.length > 50) history.value.shift();
    future.value = [];
    mutate();
    message.value = label;
    persist();
  }

  function restore(raw: string) {
    const parsed = JSON.parse(raw) as PersistedCollationState;
    versions.value = parsed.versions;
    baseVersionId.value = parsed.baseVersionId;
    referenceAId.value = parsed.referenceAId;
    referenceBId.value = parsed.referenceBId;
    rules.value = parsed.rules;
    rows.value = parsed.rows.map((row) => withAnalysis(row, rules.value, true));
    selectedRowId.value = parsed.selectedRowId;
    persist();
  }

  function undo() {
    const previous = history.value.pop();
    if (!previous) return;
    future.value.push(snapshot());
    restore(previous);
    message.value = '已撤销上一步操作';
  }

  function redo() {
    const next = future.value.pop();
    if (!next) return;
    history.value.push(snapshot());
    restore(next);
    message.value = '已重做上一步操作';
  }

  async function runAlignment(commitHistory = true) {
    if (!baseVersion.value || !referenceAVersion.value || !referenceBVersion.value || processing.value) return;
    if (
      new Set([baseVersionId.value, referenceAId.value, referenceBId.value]).size !== 3
    ) {
      message.value = '请选择三份互不相同的底本和参校本';
      return;
    }

    processing.value = true;
    progress.value = 0;
    message.value = '正在分片执行三家对齐…';
    const previous = commitHistory ? snapshot() : '';
    try {
      const result = await alignThreeWays(
        baseVersion.value.units,
        referenceAVersion.value.units,
        referenceBVersion.value.units,
        rules.value,
        (value) => {
          progress.value = value;
        }
      );
      if (commitHistory) {
        history.value.push(previous);
        future.value = [];
      }
      rows.value = result;
      selectedRowId.value = result.find((row) => row.pattern !== 'unanimous')?.id ?? result[0]?.id ?? '';
      selectedRowIds.value = [];
      message.value = `三家对齐完成：${differenceCount.value} 处非一致读法，${missingCount.value} 处缺句`;
      persist();
    } finally {
      processing.value = false;
    }
  }

  function recalculate() {
    commit('已按比较规则重算三家读法', () => {
      rows.value = rows.value.map((row) => withAnalysis(row, rules.value, true));
      selectedRowIds.value = [];
    });
  }

  function updateRow(id: string, patch: Partial<AlignmentRow>) {
    commit('已更新校勘行', () => {
      const row = rows.value.find((item) => item.id === id);
      if (row) Object.assign(row, patch, { manuallyAdjusted: true });
    });
  }

  function shiftPairing(id: string, key: WitnessKey, direction: -1 | 1) {
    commit(direction < 0 ? '已向前调整该本配对' : '已向后调整该本配对', () => {
      const index = rows.value.findIndex((row) => row.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= rows.value.length) return;
      const current = rows.value[index];
      const target = rows.value[targetIndex];
      const currentUnit = current[key];
      current[key] = target[key];
      target[key] = currentUnit;
      rows.value[index] = withAnalysis(current, rules.value);
      rows.value[targetIndex] = withAnalysis(target, rules.value);
      rows.value[index].manuallyAdjusted = true;
      rows.value[targetIndex].manuallyAdjusted = true;
    });
  }

  function moveRow(id: string, direction: -1 | 1) {
    commit('已移动三家对齐行顺序', () => {
      const index = rows.value.findIndex((row) => row.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= rows.value.length) return;
      const [row] = rows.value.splice(index, 1);
      rows.value.splice(targetIndex, 0, row);
      row.manuallyAdjusted = true;
    });
  }

  function adoptReading(id: string, source: WitnessKey) {
    const row = rows.value.find((item) => item.id === id);
    if (!row || !row[source]) return;
    const isSingleton = row.singletonReaders.includes(source);
    const requiresConfirmation = isSingleton || row.pattern === 'divergent';
    commit(requiresConfirmation ? '已指定定本读法，仍需人工确认' : '已指定定本采用的版本', () => {
      Object.assign(row, {
        adoptedSource: source,
        adoptedText: row[source]?.text,
        accepted: !requiresConfirmation,
        manuallyConfirmed: !requiresConfirmation,
        manuallyAdjusted: true
      });
    });
  }

  function confirmAdoption(id: string, accepted: boolean) {
    const row = rows.value.find((item) => item.id === id);
    if (!row) return;
    commit(accepted ? '已人工确认定本读法' : '已撤回接受状态', () => {
      row.accepted = accepted;
      row.manuallyConfirmed = accepted;
      if (accepted && row.adoptedSource) row.adoptedText = row[row.adoptedSource]?.text;
    });
  }

  function acceptRows(ids: string[]) {
    if (!ids.length) return 0;
    const selected = new Set(ids);
    const targets = rows.value.filter((row) => selected.has(row.id) && !row.accepted);
    const acceptable = targets.filter((row) => {
      if (row.pattern === 'unanimous') return true;
      if (row.pattern === 'divergent' || !row.adoptedSource) return false;
      return !row.singletonReaders.includes(row.adoptedSource);
    });
    if (!acceptable.length) return targets.length;

    commit(`已接受 ${acceptable.length} 条三家校对建议`, () => {
      acceptable.forEach((row) => {
        row.accepted = true;
        row.manuallyConfirmed = true;
        if (row.adoptedSource) row.adoptedText = row[row.adoptedSource]?.text;
      });
      selectedRowIds.value = [];
    });
    return targets.length - acceptable.length;
  }

  function acceptAll() {
    const skipped = acceptRows(rows.value.map((row) => row.id));
    if (skipped > 0) message.value = `已接受可自动采用的建议，${skipped} 条孤例、三家互异或未定读法仍需人工确认`;
  }

  function quickAccept(row: AlignmentRow) {
    if (row.accepted) return;
    if (row.pattern === 'unanimous' || (row.adoptedSource && !row.singletonReaders.includes(row.adoptedSource) && row.pattern !== 'divergent')) {
      acceptRows([row.id]);
    } else if (row.adoptedSource) {
      message.value = '该定本未获多数支持，请在右侧详情中人工确认';
    } else {
      message.value = '三家读法均不同，请先指定定本采用哪一家';
    }
  }

  function nextDifference() {
    const start = rows.value.findIndex((row) => row.id === selectedRowId.value);
    for (let offset = 1; offset <= rows.value.length; offset += 1) {
      const index = (start + offset) % rows.value.length;
      const row = rows.value[index];
      if (row && row.pattern !== 'unanimous' && !row.accepted) {
        selectedRowId.value = row.id;
        message.value = `已跳到第 ${index + 1} 条未接受读法`;
        persist();
        return;
      }
    }
    message.value = '没有更多未接受的读法';
  }

  function addVersion(name: string, source: string, text: string) {
    const id = `version-${Date.now().toString(36)}`;
    const item: VersionDocument = {
      id,
      name: name.trim() || `版本 ${versions.value.length + 1}`,
      source: source.trim() || '手工导入',
      text,
      units: splitIntoUnits(text, id),
      createdAt: new Date().toISOString()
    };
    commit(`已导入版本：${item.name}`, () => {
      versions.value.push(item);
    });
    referenceBId.value = id;
    void runAlignment();
  }

  function witnessName(key: WitnessKey) {
    return {
      base: baseVersion.value?.name ?? '底本',
      referenceA: referenceAVersion.value?.name ?? '参校本一',
      referenceB: referenceBVersion.value?.name ?? '参校本二'
    }[key];
  }

  function witnessShortName(key: WitnessKey) {
    return { base: '底', referenceA: '参一', referenceB: '参二' }[key];
  }

  function exportMarkdown() {
    const changed = rows.value.filter((row) => row.pattern !== 'unanimous' || row.note || row.source);
    const lines = [
      '# 三家校勘记',
      '',
      `- 底本：${baseVersion.value?.name ?? '未选择'}`,
      `- 参校本一：${referenceAVersion.value?.name ?? '未选择'}`,
      `- 参校本二：${referenceBVersion.value?.name ?? '未选择'}`,
      `- 比较规则：${rules.value.ignorePunctuation ? '忽略标点；' : ''}${rules.value.ignoreVariants ? '忽略异体字；' : ''}保留三份原文。`,
      `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '| 序 | 类别 | 底本依据 | 参校本一依据 | 参校本二依据 | 多数/孤例/缺句 | 定本采用 | 校记 | 来源 | 人工调序 | 状态 |',
      '|---|---|---|---|---|---|---|---|---|---|---|'
    ];
    const cell = (value?: string) => (value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
    changed.forEach((row, index) => {
      const basis = (key: WitnessKey) => {
        const readers =
          row.majorityReaders.includes(key) ? '多数' : row.singletonReaders.includes(key) ? '孤例' : row.missingReaders.includes(key) ? '缺句' : '';
        return `${cell(row[key]?.text)}${readers ? `（${readers}）` : ''}`;
      };
      const evidence = [
        row.majorityReaders.length ? `多数：${row.majorityReaders.map(witnessShortName).join('、')}` : '',
        row.singletonReaders.length ? `孤例：${row.singletonReaders.map(witnessShortName).join('、')}` : '',
        row.missingReaders.length ? `缺句：${row.missingReaders.map(witnessShortName).join('、')}` : ''
      ]
        .filter(Boolean)
        .join('；');
      lines.push(
        `| ${index + 1} | ${statusLabel(row.status)} | ${basis('base')} | ${basis('referenceA')} | ${basis('referenceB')} | ${evidence} | ${row.adoptedSource ? `${witnessName(row.adoptedSource)}：${cell(row.adoptedText)}` : '待人工指定'} | ${cell(row.note)} | ${cell(row.source)} | ${row.manuallyAdjusted ? '已人工调整' : '自动对齐'} | ${row.accepted ? `已接受${row.manuallyConfirmed ? '/人工确认' : ''}` : '待处理'} |`
      );
    });
    lines.push('', `共 ${changed.length} 条三家校勘记录。`);
    return lines.join('\n');
  }

  function exportJson() {
    return JSON.stringify(
      {
        base: baseVersion.value,
        references: [referenceAVersion.value, referenceBVersion.value],
        rules: rules.value,
        rows: rows.value,
        exportedAt: new Date().toISOString()
      },
      null,
      2
    );
  }

  onMounted(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const legacyRaw = !raw ? localStorage.getItem(LEGACY_STORAGE_KEY) : '';
      if (raw) {
        restore(raw);
        message.value = '已恢复浏览器中的三家校勘草稿';
      } else if (legacyRaw) {
        const migrated = migrateLegacyState(legacyRaw);
        if (migrated) {
          versions.value = migrated.versions;
          baseVersionId.value = migrated.baseVersionId;
          referenceAId.value = migrated.referenceAId;
          referenceBId.value = migrated.referenceBId;
          rules.value = migrated.rules;
          rows.value = migrated.rows.map((row) => withAnalysis(row, rules.value, true));
          selectedRowId.value = migrated.selectedRowId;
          persist();
          message.value = '已从旧版两本草稿迁移为三家对齐，请执行自动对齐补全第三本';
        } else {
          throw new Error('migration failed');
        }
      } else {
        message.value = '已载入三份示例版本，正在自动对齐…';
        void runAlignment(false);
      }
    } catch {
      message.value = '本地草稿读取失败，已载入三份示例数据';
      void runAlignment(false);
    }
  });

  watch(
    [
      baseVersionId,
      referenceAId,
      referenceBId,
      () => rules.value.ignorePunctuation,
      () => rules.value.ignoreVariants
    ],
    () => {
      if (!processing.value) persist();
    }
  );

  return {
    versions,
    baseVersionId,
    referenceAId,
    referenceBId,
    rows,
    rules,
    selectedRowId,
    selectedRowIds,
    processing,
    progress,
    message,
    history,
    future,
    canUndo,
    canRedo,
    canAlign,
    baseVersion,
    referenceAVersion,
    referenceBVersion,
    selectedRow,
    differenceCount,
    missingCount,
    singletonCount,
    acceptedCount,
    unresolvedCount,
    runAlignment,
    recalculate,
    updateRow,
    shiftPairing,
    moveRow,
    adoptReading,
    confirmAdoption,
    acceptRows,
    acceptAll,
    quickAccept,
    nextDifference,
    addVersion,
    witnessName,
    witnessShortName,
    undo,
    redo,
    exportMarkdown,
    exportJson,
    commit
  };
}

export function statusLabel(status: DifferenceStatus) {
  return {
    same: '三家相同',
    changed: '异文',
    added: '底本缺句',
    removed: '参校缺句',
    misaligned: '疑错位'
  }[status];
}

export function patternLabel(pattern: ReadingPattern) {
  return {
    unanimous: '三家一致',
    majority: '多数一致',
    divergent: '三家互异'
  }[pattern];
}
