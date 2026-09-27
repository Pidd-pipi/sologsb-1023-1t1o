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
  WitnessKey,
  WitnessVersionIds
} from '../types';

const STORAGE_KEY = 'sologsb-1023/multi-version-collation/v2';

export const witnessKeys: WitnessKey[] = ['base', 'reference1', 'reference2'];

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

type WitnessSlots = Partial<Record<WitnessKey, TextUnit>>;

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

function pairSimilarity(left: TextUnit | undefined, right: TextUnit | undefined, rules: ComparisonRules) {
  if (!left || !right) return undefined;
  return Number(
    similarity(normalized(left.text, rules), normalized(right.text, rules)).toFixed(3)
  );
}

function witnessOf(row: AlignmentRow, key: WitnessKey) {
  return row[key];
}

export function getWitnessUnit(row: AlignmentRow, key: WitnessKey) {
  return witnessOf(row, key);
}

export function witnessEntries(row: AlignmentRow, versions: VersionDocument[]) {
  return witnessKeys.map((key) => {
    const versionId = row.witnessVersionIds[key];
    return {
      key,
      versionId,
      version: versions.find((item) => item.id === versionId),
      unit: witnessOf(row, key)
    };
  });
}

export function versionName(versions: VersionDocument[], id: string | undefined) {
  if (!id) return '未选择';
  return versions.find((item) => item.id === id)?.name ?? id;
}

function makeWitnessVersionIds(baseId: string, reference1Id: string, reference2Id: string): WitnessVersionIds {
  return { base: baseId, reference1: reference1Id, reference2: reference2Id };
}

export function readingRequiresReview(
  pattern: ReadingPattern,
  status: DifferenceStatus,
  adoptedVersionId: string | undefined,
  singletonVersionId?: string
) {
  return (
    pattern === 'divergent' ||
    pattern === 'incomplete' ||
    status === 'misaligned' ||
    (pattern === 'majority' && adoptedVersionId === singletonVersionId)
  );
}

function analyzeRow(row: AlignmentRow, rules: ComparisonRules): AlignmentRow {
  const units = [row.base, row.reference1, row.reference2].filter(Boolean) as TextUnit[];
  const baseReference1 = pairSimilarity(row.base, row.reference1, rules);
  const baseReference2 = pairSimilarity(row.base, row.reference2, rules);
  const reference1Reference2 = pairSimilarity(row.reference1, row.reference2, rules);
  const pairValues = [baseReference1, baseReference2, reference1Reference2].filter(
    (value): value is number => value !== undefined
  );
  const averageSimilarity = pairValues.length
    ? Number((pairValues.reduce((sum, value) => sum + value, 0) / pairValues.length).toFixed(3))
    : 0;

  const readings = new Map<string, string[]>();
  units.forEach((unit) => {
    const value = normalized(unit.text, rules);
    readings.set(value, [...(readings.get(value) ?? []), unit.versionId]);
  });

  const presentVersionIds = units.map((unit) => unit.versionId);
  const missingVersionIds = witnessKeys
    .map((key) => row.witnessVersionIds[key])
    .filter((id) => !presentVersionIds.includes(id));

  let readingPattern: ReadingPattern;
  let agreementVersionIds: string[] = [];
  let singletonVersionId: string | undefined;

  if (units.length < 3) {
    readingPattern = 'incomplete';
    if (units.length === 2 && readings.size === 1) agreementVersionIds = presentVersionIds;
  } else if (readings.size === 1) {
    readingPattern = 'unanimous';
    agreementVersionIds = presentVersionIds;
  } else {
    const groups = Array.from(readings.values()).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
    if (groups[0].length === 2) {
      readingPattern = 'majority';
      agreementVersionIds = groups[0];
      singletonVersionId = groups[1][0];
    } else {
      readingPattern = 'divergent';
    }
  }

  let status: DifferenceStatus;
  if (units.length < 3) {
    status = 'missing';
  } else if (readingPattern === 'unanimous') {
    status = 'same';
  } else if (averageSimilarity < 0.38) {
    status = 'misaligned';
  } else {
    status = 'changed';
  }

  let suggestedAdoption: string | undefined;
  if (readingPattern === 'unanimous' || readingPattern === 'majority') {
    suggestedAdoption = row.witnessVersionIds.base && agreementVersionIds.includes(row.witnessVersionIds.base)
      ? row.witnessVersionIds.base
      : agreementVersionIds[0];
  } else if (units.length === 2) {
    suggestedAdoption = row.base?.versionId ?? units[0].versionId;
  } else if (units.length === 1) {
    suggestedAdoption = units[0].versionId;
  }

  const requiresManualConfirmation = readingRequiresReview(
    readingPattern,
    status,
    suggestedAdoption,
    singletonVersionId
  );

  return {
    ...row,
    status,
    readingPattern,
    pairSimilarities: {
      baseReference1,
      baseReference2,
      reference1Reference2
    },
    similarity: averageSimilarity,
    agreementVersionIds,
    singletonVersionId,
    missingVersionIds,
    adoptedVersionId: row.manualConfirmed ? row.adoptedVersionId : suggestedAdoption,
    accepted: row.manualConfirmed
      ? row.accepted && !requiresManualConfirmation
      : !requiresManualConfirmation && Boolean(suggestedAdoption)
  };
}

function buildRow(slots: WitnessSlots, rules: ComparisonRules, witnessVersionIds: WitnessVersionIds) {
  const row: AlignmentRow = {
    id: '',
    base: slots.base,
    reference1: slots.reference1,
    reference2: slots.reference2,
    witnessVersionIds,
    status: 'changed',
    readingPattern: 'divergent',
    pairSimilarities: {},
    similarity: 0,
    agreementVersionIds: [],
    missingVersionIds: [],
    manualConfirmed: false,
    note: '',
    source: '',
    accepted: false,
    manuallyAdjusted: false
  };
  return analyzeRow(row, rules);
}

function candidateScore(slots: WitnessSlots, rules: ComparisonRules) {
  const present = [slots.base, slots.reference1, slots.reference2].filter(Boolean) as TextUnit[];
  if (!present.length) return -1;
  if (present.length === 1) return present[0].paragraphOrder > 0 ? 0.1 : 0.08;

  const values = [
    pairSimilarity(slots.base, slots.reference1, rules),
    pairSimilarity(slots.base, slots.reference2, rules),
    pairSimilarity(slots.reference1, slots.reference2, rules)
  ].filter((value): value is number => value !== undefined);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;

  if (present.length === 3) {
    const paragraphs = new Set(present.map((unit) => unit.paragraphOrder));
    const sameParagraph = paragraphs.size === 1;
    const [base, reference1, reference2] = present;
    const sentenceIndexSpread = Math.max(
      Math.abs(base.sentenceOrder - reference1.sentenceOrder),
      Math.abs(base.sentenceOrder - reference2.sentenceOrder),
      Math.abs(reference1.sentenceOrder - reference2.sentenceOrder)
    );
    const structuralMatch = sameParagraph && sentenceIndexSpread <= 1;
    const gapPenalty = sameParagraph
      ? 0
      : Math.min(
          0.16,
          0.04 *
            (Math.abs((slots.base?.paragraphOrder ?? 0) - (slots.reference1?.paragraphOrder ?? 0)) +
              Math.abs((slots.base?.paragraphOrder ?? 0) - (slots.reference2?.paragraphOrder ?? 0)) +
              Math.abs((slots.reference1?.paragraphOrder ?? 0) - (slots.reference2?.paragraphOrder ?? 0)))
        );
    const structuralScore = structuralMatch ? 0.82 + average * 0.08 : average;
    return Number((structuralScore + (sameParagraph && !structuralMatch ? 0.1 : 0) - gapPenalty).toFixed(3));
  }

  const sameParagraph = present[0].paragraphOrder === present[1].paragraphOrder;
  return Number((average + (sameParagraph ? 0.08 : -0.05)).toFixed(3));
}

async function alignUnits(
  versionIds: WitnessVersionIds,
  unitSets: Record<WitnessKey, TextUnit[]>,
  rules: ComparisonRules,
  onProgress: (value: number) => void
): Promise<AlignmentRow[]> {
  const rows: AlignmentRow[] = [];
  const indexes: Record<WitnessKey, number> = { base: 0, reference1: 0, reference2: 0 };
  const totals = witnessKeys.map((key) => unitSets[key].length);
  const total = Math.max(1, totals.reduce((sum, value) => sum + value, 0));
  const masks: Array<{ mask: number; present: number }> = [
    { mask: 0b111, present: 3 },
    { mask: 0b110, present: 2 },
    { mask: 0b101, present: 2 },
    { mask: 0b011, present: 2 },
    { mask: 0b100, present: 1 },
    { mask: 0b010, present: 1 },
    { mask: 0b001, present: 1 }
  ];

  while (witnessKeys.some((key) => indexes[key] < unitSets[key].length)) {
    let best: { slots: WitnessSlots; score: number; present: number; mask: number } | undefined;

    for (const candidate of masks) {
      const slots: WitnessSlots = {};
      let available = 0;
      witnessKeys.forEach((key, bitIndex) => {
        const bit = 1 << (2 - bitIndex);
        if (candidate.mask & bit) {
          const unit = unitSets[key][indexes[key]];
          if (!unit) return;
          slots[key] = unit;
          available += 1;
        }
      });
      if (!available) continue;
      const score = candidateScore(slots, rules);
      if (!best || score > best.score || (score === best.score && candidate.present > best.present)) {
        best = { slots, score, present: candidate.present, mask: candidate.mask };
      }
    }

    if (!best) break;
    const row = buildRow(best.slots, rules, versionIds);
    row.id = `row-${rows.length + 1}-${witnessKeys
      .map((key) => best?.slots[key]?.id ?? 'gap')
      .join('-')}`;
    rows.push(row);

    witnessKeys.forEach((key, bitIndex) => {
      const bit = 1 << (2 - bitIndex);
      if (best?.mask & bit) indexes[key] += 1;
    });

    if (rows.length % 24 === 0) {
      const consumed = witnessKeys.reduce((sum, key) => sum + indexes[key], 0);
      onProgress(Math.round((consumed / total) * 100));
      await yieldToBrowser();
    }
  }

  onProgress(100);
  return rows;
}

function defaultRules(): ComparisonRules {
  return { ignorePunctuation: true, ignoreVariants: true, candidateWindow: 3 };
}

export function useCollation() {
  const versions = ref<VersionDocument[]>(clone(sampleVersions));
  const baseVersionId = ref(versions.value[0].id);
  const reference1VersionId = ref(versions.value[1].id);
  const reference2VersionId = ref(versions.value[2].id);
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
  const reference1Version = computed(() => versions.value.find((item) => item.id === reference1VersionId.value));
  const reference2Version = computed(() => versions.value.find((item) => item.id === reference2VersionId.value));
  const selectedRow = computed(() => rows.value.find((item) => item.id === selectedRowId.value));
  const differenceCount = computed(() => rows.value.filter((row) => row.status !== 'same').length);
  const acceptedCount = computed(() => rows.value.filter((row) => row.accepted).length);
  const unresolvedCount = computed(() => rows.value.filter((row) => row.status !== 'same' && !row.accepted).length);

  function snapshot(): string {
    const data: PersistedCollationState = {
      schemaVersion: 2,
      versions: versions.value,
      baseVersionId: baseVersionId.value,
      reference1VersionId: reference1VersionId.value,
      reference2VersionId: reference2VersionId.value,
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
    if (parsed.schemaVersion !== 2) throw new Error('Unsupported collation state');
    versions.value = parsed.versions;
    baseVersionId.value = parsed.baseVersionId;
    reference1VersionId.value = parsed.reference1VersionId;
    reference2VersionId.value = parsed.reference2VersionId;
    rows.value = parsed.rows;
    rules.value = parsed.rules;
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
    const ids = [baseVersionId.value, reference1VersionId.value, reference2VersionId.value];
    if (new Set(ids).size !== 3 || versions.value.length < 3) {
      message.value = '请分别选择底本、参校本一和参校本二，三份版本不能重复';
      return false;
    }
    if (processing.value) return false;

    processing.value = true;
    progress.value = 0;
    message.value = '正在分片执行三本对对齐…';
    const previous = commitHistory ? snapshot() : '';
    try {
      const versionIdRecord = makeWitnessVersionIds(ids[0], ids[1], ids[2]);
      const selectedVersions = witnessKeys.map((key) => versions.value.find((item) => item.id === versionIdRecord[key])!);
      const result = await alignUnits(
        versionIdRecord,
        {
          base: selectedVersions[0].units,
          reference1: selectedVersions[1].units,
          reference2: selectedVersions[2].units
        },
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
      selectedRowId.value = result.find((row) => row.status !== 'same')?.id ?? result[0]?.id ?? '';
      selectedRowIds.value = [];
      message.value = `三本对自动对齐完成：${result.filter((row) => row.status !== 'same').length} 处待校记录`;
      persist();
      return true;
    } finally {
      processing.value = false;
    }
  }

  function recalculate() {
    commit('已按比较规则重算三本异文', () => {
      rows.value = rows.value.map((row) => analyzeRow({ ...row }, rules.value));
      selectedRowIds.value = [];
    });
  }

  function updateRow(id: string, patch: Partial<AlignmentRow>) {
    commit('已更新校勘行', () => {
      const row = rows.value.find((item) => item.id === id);
      if (!row) return;
      Object.assign(row, patch);
      if ('status' in patch || 'adoptedVersionId' in patch || 'manualConfirmed' in patch) {
        row.manuallyAdjusted = true;
      }
    });
  }

  function setStatus(id: string, status: DifferenceStatus) {
    updateRow(id, { status, accepted: false, manualConfirmed: false });
  }

  function adoptReading(id: string, versionId: string) {
    updateRow(id, { adoptedVersionId: versionId, accepted: false });
  }

  function setManualConfirmed(id: string, value: boolean) {
    updateRow(id, value ? { manualConfirmed: true, accepted: false } : { manualConfirmed: false });
  }

  function canAcceptRow(row: AlignmentRow) {
    const needsReview = readingRequiresReview(
      row.readingPattern,
      row.status,
      row.adoptedVersionId,
      row.singletonVersionId
    );
    return Boolean(row.adoptedVersionId) && (!needsReview || row.manualConfirmed);
  }

  function refreshWitnessPair(row: AlignmentRow) {
    const refreshed = analyzeRow({ ...row, manualConfirmed: false, accepted: false }, rules.value);
    Object.assign(row, refreshed, { manuallyAdjusted: true });
  }

  function shiftWitness(id: string, witnessKey: WitnessKey, direction: -1 | 1) {
    commit(direction < 0 ? '已向前调整该版本配对' : '已向后调整该版本配对', () => {
      const index = rows.value.findIndex((row) => row.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= rows.value.length) return;
      const current = rows.value[index];
      const target = rows.value[targetIndex];
      const currentUnit = current[witnessKey];
      current[witnessKey] = target[witnessKey];
      target[witnessKey] = currentUnit;
      refreshWitnessPair(current);
      refreshWitnessPair(target);
    });
  }

  function moveRow(id: string, direction: -1 | 1) {
    commit('已移动三条对齐记录顺序', () => {
      const index = rows.value.findIndex((row) => row.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= rows.value.length) return;
      const [row] = rows.value.splice(index, 1);
      rows.value.splice(targetIndex, 0, row);
      row.manuallyAdjusted = true;
    });
  }

  function acceptRows(ids: string[]) {
    const selected = new Set(ids);
    const targets = rows.value.filter((row) => selected.has(row.id));
    const acceptable = targets.filter(canAcceptRow);
    const blocked = targets.length - acceptable.length;
    if (!acceptable.length) {
      message.value = '所选记录仍需指定定本并完成人工确认';
      return { accepted: 0, blocked };
    }
    commit(`已接受 ${acceptable.length} 条三本对校记录`, () => {
      acceptable.forEach((row) => {
        row.accepted = true;
      });
      selectedRowIds.value = [];
    });
    if (blocked) message.value = `已接受 ${acceptable.length} 条；${blocked} 条孤证、缺句或疑错位仍需人工确认`;
    return { accepted: acceptable.length, blocked };
  }

  function acceptAll() {
    const acceptable = rows.value.filter(canAcceptRow);
    const blocked = rows.value.length - acceptable.length;
    if (!acceptable.length) {
      message.value = '没有可直接接受的记录；孤证、缺句和三家分歧需人工确认';
      return { accepted: 0, blocked };
    }
    commit(`已批量接受 ${acceptable.length} 条校勘记录`, () => {
      acceptable.forEach((row) => {
        row.accepted = true;
      });
      selectedRowIds.value = [];
    });
    if (blocked) message.value = `已接受 ${acceptable.length} 条；${blocked} 条仍需人工确认`;
    return { accepted: acceptable.length, blocked };
  }

  function nextDifference() {
    const start = rows.value.findIndex((row) => row.id === selectedRowId.value);
    for (let offset = 1; offset <= rows.value.length; offset += 1) {
      const index = (start + offset) % rows.value.length;
      const row = rows.value[index];
      if (row && row.status !== 'same' && !row.accepted) {
        selectedRowId.value = row.id;
        message.value = `已跳到第 ${index + 1} 条待校记录`;
        persist();
        return;
      }
    }
    message.value = '没有更多未接受的异文或缺句';
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
    reference2VersionId.value = id;
    void runAlignment();
  }

  function cell(value?: string) {
    return (value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
  }

  function namesOf(ids: string[]) {
    return ids.length ? ids.map((id) => versionName(versions.value, id)).join('、') : '—';
  }

  function evidenceSummary(row: AlignmentRow) {
    if (row.readingPattern === 'unanimous') return `三家一致：${namesOf(row.agreementVersionIds)}`;
    if (row.readingPattern === 'majority') return `两家一致：${namesOf(row.agreementVersionIds)}`;
    if (row.readingPattern === 'divergent') return '三家异文';
    if (row.missingVersionIds.length) return `缺句：${namesOf(row.missingVersionIds)}`;
    return '依据不完整';
  }

  function exportMarkdown() {
    const changed = rows.value.filter((row) => row.status !== 'same' || row.note || row.source || !row.accepted);
    const witnessMeta = [
      ['底本', baseVersion.value],
      ['参校本一', reference1Version.value],
      ['参校本二', reference2Version.value]
    ] as const;
    const lines = [
      '# 三本对校勘记',
      '',
      ...witnessMeta.map(([role, version]) => `- ${role}：${version?.name ?? '未选择'}（${version?.source ?? '未注明来源'}）`),
      `- 比较规则：${rules.value.ignorePunctuation ? '忽略标点；' : '保留标点；'}${rules.value.ignoreVariants ? '忽略常见异体字；' : '不忽略异体字；'}三份原文均不改写。`,
      `- 人工调序：${rows.value.filter((row) => row.manuallyAdjusted).length} 条；待人工确认：${rows.value.filter((row) => !row.accepted && row.status !== 'same').length} 条。`,
      `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '| 序 | 判定 | 三份依据 | 底本原文 | 参校本一原文 | 参校本二原文 | 多数/孤证 | 定本采用 | 人工确认 | 接受状态 | 人工调序 | 校记 | 校记来源 |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|'
    ];
    changed.forEach((row, index) => {
      lines.push(
        `| ${index + 1} | ${statusLabel(row.status)} | ${evidenceSummary(row)} | ${cell(row.base?.text)} | ${cell(row.reference1?.text)} | ${cell(row.reference2?.text)} | ${
          row.singletonVersionId ? `孤证：${versionName(versions.value, row.singletonVersionId)}` : namesOf(row.agreementVersionIds)
        } | ${cell(versionName(versions.value, row.adoptedVersionId))} | ${row.manualConfirmed ? '已确认' : '待确认'} | ${row.accepted ? '已接受' : '待处理'} | ${row.manuallyAdjusted ? '是' : '否'} | ${cell(row.note)} | ${cell(row.source)} |`
      );
    });
    lines.push('', `共 ${changed.length} 条校勘记录，每条均保留底本与两份参校本依据。`);
    return lines.join('\n');
  }

  function exportJson() {
    return JSON.stringify(
      {
        schemaVersion: 2,
        witnesses: {
          base: baseVersion.value,
          reference1: reference1Version.value,
          reference2: reference2Version.value
        },
        rules: rules.value,
        rows: rows.value.map((row) => ({
          ...row,
          evidence: {
            base: { versionId: row.witnessVersionIds.base, unit: row.base },
            reference1: { versionId: row.witnessVersionIds.reference1, unit: row.reference1 },
            reference2: { versionId: row.witnessVersionIds.reference2, unit: row.reference2 },
            readingPattern: row.readingPattern,
            agreementVersionIds: row.agreementVersionIds,
            singletonVersionId: row.singletonVersionId,
            missingVersionIds: row.missingVersionIds,
            adoptedVersionId: row.adoptedVersionId,
            manualConfirmed: row.manualConfirmed,
            manuallyAdjusted: row.manuallyAdjusted,
            accepted: row.accepted
          }
        })),
        exportedAt: new Date().toISOString()
      },
      null,
      2
    );
  }

  onMounted(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        restore(raw);
        message.value = '已恢复浏览器中的三本对校勘草稿';
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
      reference1VersionId,
      reference2VersionId,
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
    reference1VersionId,
    reference2VersionId,
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
    baseVersion,
    reference1Version,
    reference2Version,
    selectedRow,
    differenceCount,
    acceptedCount,
    unresolvedCount,
    runAlignment,
    recalculate,
    updateRow,
    setStatus,
    adoptReading,
    setManualConfirmed,
    canAcceptRow,
    shiftWitness,
    moveRow,
    acceptRows,
    acceptAll,
    nextDifference,
    addVersion,
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
    missing: '缺句',
    misaligned: '疑错位'
  }[status];
}

export function readingPatternLabel(pattern: ReadingPattern) {
  return {
    unanimous: '三家一致',
    majority: '两家一致',
    divergent: '三家分歧',
    incomplete: '缺句/孤本'
  }[pattern];
}
