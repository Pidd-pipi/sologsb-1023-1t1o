<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Message } from '@arco-design/web-vue';
import {
  readingPatternLabel,
  readingRequiresReview,
  statusLabel,
  useCollation,
  versionName,
  witnessEntries
} from './composables/useCollation';
import type {
  AlignmentRow,
  DifferenceStatus,
  ReadingPattern,
  VersionDocument,
  WitnessKey
} from './types';

const {
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
  canUndo,
  canRedo,
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
  exportJson
} = useCollation();

const importVisible = ref(false);
const onlyDifferences = ref(false);
const rowQuery = ref('');
const noteDraft = ref('');
const sourceDraft = ref('');
const importForm = ref({ name: '', source: '', text: '' });
const fileInput = ref<HTMLInputElement | null>(null);

const columns = [
  { title: '状态 / 依据', dataIndex: 'status', slotName: 'status', width: 136, fixed: 'left' as const },
  { title: '底本', dataIndex: 'base', slotName: 'base', width: 265 },
  { title: '参校本一', dataIndex: 'reference1', slotName: 'reference1', width: 265 },
  { title: '参校本二', dataIndex: 'reference2', slotName: 'reference2', width: 265 },
  { title: '多数 / 孤证 / 缺句', dataIndex: 'consensus', slotName: 'consensus', width: 220 },
  { title: '定本采用', dataIndex: 'adoption', slotName: 'adoption', width: 220 },
  { title: '调序', dataIndex: 'order', slotName: 'order', width: 88, align: 'center' as const },
  { title: '校记 / 来源', dataIndex: 'note', slotName: 'note', width: 235 }
];

const filteredRows = computed(() => {
  const query = rowQuery.value.trim().toLocaleLowerCase();
  return rows.value.filter((row) => {
    if (onlyDifferences.value && row.status === 'same') return false;
    if (!query) return true;
    const searchable = [
      row.base?.text,
      row.reference1?.text,
      row.reference2?.text,
      row.note,
      row.source,
      statusLabel(row.status),
      readingPatternLabel(row.readingPattern),
      ...row.agreementVersionIds.map((id) => versionName(versions.value, id)),
      row.singletonVersionId ? versionName(versions.value, row.singletonVersionId) : undefined,
      ...row.missingVersionIds.map((id) => versionName(versions.value, id)),
      row.adoptedVersionId ? versionName(versions.value, row.adoptedVersionId) : undefined
    ];
    return searchable
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query));
  });
});

const rowSelection = computed(() => ({
  type: 'checkbox' as const,
  showCheckedAll: true,
  selectedRowKeys: selectedRowIds.value,
  onlyCurrent: false
}));

const selectedWitnessEntries = computed(() => (selectedRow.value ? witnessEntries(selectedRow.value, versions.value) : []));
const adoptedText = computed(() => {
  if (!selectedRow.value?.adoptedVersionId) return '尚未指定定本';
  const entry = selectedWitnessEntries.value.find((item) => item.versionId === selectedRow.value?.adoptedVersionId);
  return entry?.unit?.text ?? '所选版本在本行缺句，请重新指定定本';
});

watch(
  selectedRow,
  (row) => {
    noteDraft.value = row?.note ?? '';
    sourceDraft.value = row?.source ?? '';
  },
  { immediate: true }
);

function statusColor(status: DifferenceStatus) {
  return {
    same: 'gray',
    changed: 'orange',
    missing: 'red',
    misaligned: 'purple'
  }[status] as 'gray' | 'orange' | 'red' | 'purple';
}

function patternColor(pattern: ReadingPattern) {
  return {
    unanimous: 'green',
    majority: 'arcoblue',
    divergent: 'magenta',
    incomplete: 'orangered'
  }[pattern] as 'green' | 'arcoblue' | 'magenta' | 'orangered';
}

function needsManual(row: AlignmentRow) {
  return readingRequiresReview(row.readingPattern, row.status, row.adoptedVersionId, row.singletonVersionId);
}

function rowClass(record: AlignmentRow) {
  return [
    record.id === selectedRowId.value ? 'row-active' : '',
    needsManual(record) ? 'row-needs-review' : ''
  ];
}

function onSelectionChange(keys: (string | number)[]) {
  selectedRowIds.value = keys;
}

function updateStatus(status: unknown) {
  if (!selectedRow.value) return;
  setStatus(selectedRow.value.id, String(status) as DifferenceStatus);
}

function onRowClick(record: Record<string, unknown>) {
  const row = record as unknown as AlignmentRow;
  selectedRowId.value = row.id;
}

function saveAnnotation() {
  if (!selectedRow.value) return;
  updateRow(selectedRow.value.id, {
    note: noteDraft.value.trim(),
    source: sourceDraft.value.trim()
  });
  Message.success('校勘说明与三份依据已一并保存');
}

function chooseAdoption(versionId: unknown) {
  if (!selectedRow.value || typeof versionId !== 'string') return;
  adoptReading(selectedRow.value.id, versionId);
}

function confirmSingleton(value: unknown) {
  if (!selectedRow.value) return;
  setManualConfirmed(selectedRow.value.id, Boolean(value));
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function handleExport(kind: 'markdown' | 'json') {
  if (kind === 'markdown') {
    download('三本对校勘记.md', exportMarkdown(), 'text/markdown;charset=utf-8');
  } else {
    download('三本对校勘数据.json', exportJson(), 'application/json;charset=utf-8');
  }
}

function openImport() {
  importForm.value = { name: `导入版本 ${versions.value.length + 1}`, source: '', text: '' };
  importVisible.value = true;
}

function confirmImport() {
  if (!importForm.value.text.trim()) {
    Message.warning('请粘贴版本正文或选择文本文件');
    return;
  }
  addVersion(importForm.value.name, importForm.value.source, importForm.value.text.trim());
  importVisible.value = false;
}

function handleFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  file.text().then((text) => {
    importForm.value.text = text;
    if (!importForm.value.name || importForm.value.name.startsWith('导入版本')) {
      importForm.value.name = file.name.replace(/\.[^.]+$/, '');
    }
  });
}

function shift(row: AlignmentRow, witness: WitnessKey, direction: -1 | 1) {
  shiftWitness(row.id, witness, direction);
}

function disabledVersion(id: string, currentId: string) {
  const selected = [baseVersionId.value, reference1VersionId.value, reference2VersionId.value].filter(
    (value) => value !== currentId
  );
  return selected.includes(id);
}

function versionOptions(currentId: string) {
  return versions.value.map((version: VersionDocument) => ({
    ...version,
    disabled: disabledVersion(version.id, currentId)
  }));
}

function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if (typing) return;
  if (event.altKey && event.key === 'ArrowDown') {
    event.preventDefault();
    nextDifference();
  } else if (event.key.toLowerCase() === 'a' && selectedRowIds.value.length) {
    acceptRows(selectedRowIds.value.map(String));
  }
}

window.addEventListener('keydown', handleKeydown);

const beforeUnload = (event: BeforeUnloadEvent) => {
  if (unresolvedCount.value > 0) {
    event.preventDefault();
    event.returnValue = '';
  }
};
window.addEventListener('beforeunload', beforeUnload);
</script>

<template>
  <a-layout class="workbench-shell">
    <a-layout-header class="topbar">
      <div class="topbar-row">
        <div class="brand-mark">校</div>
        <div>
          <h1 class="brand-title">校异斋 · 三本对校勘台</h1>
          <div class="brand-subtitle">底本与两份参校本同行对齐；多数、孤证、缺句和定本依据完整保留</div>
        </div>
        <a-space class="top-actions" wrap>
          <a-button :disabled="!canUndo" @click="undo">撤销</a-button>
          <a-button :disabled="!canRedo" @click="redo">重做</a-button>
          <a-button type="primary" :loading="processing" @click="runAlignment()">重新自动对齐</a-button>
          <a-button @click="openImport">导入版本</a-button>
          <a-dropdown>
            <a-button>导出校勘记</a-button>
            <template #content>
              <a-doption @click="handleExport('markdown')">Markdown 校勘记</a-doption>
              <a-doption @click="handleExport('json')">JSON 校勘数据</a-doption>
            </template>
          </a-dropdown>
        </a-space>
      </div>
    </a-layout-header>

    <a-layout class="main-layout">
      <a-layout-sider class="left-panel" :width="292">
        <section class="panel-section">
          <h2 class="panel-title">三份版本</h2>
          <div class="version-select-grid">
            <a-select v-model="baseVersionId" aria-label="底本">
              <template #prefix>底本</template>
              <a-option v-for="version in versionOptions(baseVersionId)" :key="version.id" :value="version.id" :disabled="version.disabled">
                {{ version.name }}
              </a-option>
            </a-select>
            <a-select v-model="reference1VersionId" aria-label="参校本一">
              <template #prefix>参一</template>
              <a-option v-for="version in versionOptions(reference1VersionId)" :key="version.id" :value="version.id" :disabled="version.disabled">
                {{ version.name }}
              </a-option>
            </a-select>
            <a-select v-model="reference2VersionId" aria-label="参校本二">
              <template #prefix>参二</template>
              <a-option v-for="version in versionOptions(reference2VersionId)" :key="version.id" :value="version.id" :disabled="version.disabled">
                {{ version.name }}
              </a-option>
            </a-select>
            <a-button long type="outline" @click="runAlignment()">执行三版本分片对齐</a-button>
          </div>
          <a-progress v-if="processing" :percent="progress" size="small" style="margin-top: 12px" />
          <div v-if="processing" class="hint-text">正在让出主线程，长文本处理期间仍可查看界面</div>
        </section>

        <section class="panel-section">
          <h2 class="panel-title">比较规则（同时作用于三份）</h2>
          <a-space direction="vertical" fill>
            <a-checkbox :model-value="rules.ignorePunctuation" @change="rules.ignorePunctuation = Boolean($event); recalculate()">
              忽略标点差异
            </a-checkbox>
            <a-checkbox :model-value="rules.ignoreVariants" @change="rules.ignoreVariants = Boolean($event); recalculate()">
              忽略常见异体字
            </a-checkbox>
          </a-space>
          <div class="hint-text" style="margin-top: 10px">
            规则只重算多数一致、孤证、缺句和疑错位；三份原文始终不改写。
          </div>
        </section>

        <section class="panel-section">
          <h2 class="panel-title">处理进度</h2>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-number">{{ differenceCount }}</div>
              <div class="stat-label">异文 / 缺句</div>
            </div>
            <div class="stat-card">
              <div class="stat-number stat-warning">{{ unresolvedCount }}</div>
              <div class="stat-label">待校勘</div>
            </div>
            <div class="stat-card">
              <div class="stat-number stat-success">{{ acceptedCount }}</div>
              <div class="stat-label">已接受</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">{{ rows.length }}</div>
              <div class="stat-label">对齐句段</div>
            </div>
          </div>
          <a-button long type="primary" status="success" style="margin-top: 12px" :disabled="!unresolvedCount" @click="acceptAll">
            接受可确认建议
          </a-button>
          <a-button long style="margin-top: 8px" @click="nextDifference">跳到下一处未接受异文</a-button>
        </section>

        <section class="panel-section">
          <h2 class="panel-title">键盘辅助</h2>
          <div class="shortcut-list">
            <div><a-tag size="small">Alt ↓</a-tag> 下一处差异</div>
            <div><a-tag size="small">A</a-tag> 接受勾选记录</div>
            <div><a-tag size="small">Ctrl/⌘ Z</a-tag> 撤销</div>
            <div><a-tag size="small">Ctrl/⌘ Y</a-tag> 重做</div>
          </div>
        </section>
      </a-layout-sider>

      <a-layout-content class="center-panel">
        <a-card :bordered="false" style="margin-bottom: 12px">
          <div class="toolbar">
            <a-input-search v-model="rowQuery" placeholder="搜索三份原文、定本、校记或来源" allow-clear style="max-width: 390px" />
            <a-checkbox v-model="onlyDifferences">只看异文 / 缺句</a-checkbox>
            <a-tag color="arcoblue">{{ filteredRows.length }} / {{ rows.length }} 行</a-tag>
            <a-tag v-if="selectedRowIds.length" color="green">{{ selectedRowIds.length }} 行已勾选</a-tag>
            <a-button
              v-if="selectedRowIds.length"
              type="primary"
              status="success"
              size="small"
              style="margin-left: auto"
              @click="acceptRows(selectedRowIds.map(String))"
            >
              接受勾选记录
            </a-button>
          </div>
        </a-card>

        <a-card :bordered="false" :body-style="{ padding: 0 }">
          <a-alert :show-icon="processing" :type="unresolvedCount ? 'warning' : 'success'" style="border-radius: 0">
            {{ message }}<span v-if="unresolvedCount"> · {{ unresolvedCount }} 条异文、缺句或孤证尚未接受</span>
          </a-alert>
          <a-table
            class="virtual-table"
            row-key="id"
            :columns="columns"
            :data="filteredRows"
            :pagination="false"
            :row-selection="rowSelection"
            :row-class="rowClass"
            :scroll="{ x: 1760, y: 'calc(100vh - 260px)' }"
            :virtual-list-props="{ height: 590, threshold: 40 }"
            @selection-change="onSelectionChange"
            @row-click="onRowClick"
          >
            <template #status="{ record }">
              <a-space direction="vertical" :size="4">
                <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
                <a-tag :color="patternColor(record.readingPattern)">{{ readingPatternLabel(record.readingPattern) }}</a-tag>
              </a-space>
              <div class="mini-metric">平均相似度 {{ Math.round(record.similarity * 100) }}%</div>
              <a-tag v-if="record.manuallyAdjusted" size="small" color="arcoblue" style="margin-top: 4px">人工调序</a-tag>
            </template>

            <template #base="{ record }">
              <div v-if="record.base" class="witness-cell">
                <div class="paragraph-label">段 {{ record.base.paragraphOrder }} · 句 {{ record.base.sentenceOrder }}</div>
                <div
                  class="diff-text"
                  :class="{
                    same: record.agreementVersionIds.includes(record.base.versionId),
                    changed: !record.agreementVersionIds.includes(record.base.versionId),
                    singleton: record.singletonVersionId === record.base.versionId
                  }"
                >{{ record.base.text }}</div>
                <div class="cell-badges">
                  <a-tag v-if="record.singletonVersionId === record.base.versionId" size="small" color="orangered">孤证</a-tag>
                  <a-tag v-else-if="record.agreementVersionIds.includes(record.base.versionId) && record.agreementVersionIds.length === 2" size="small" color="arcoblue">多数</a-tag>
                  <a-tag v-else-if="record.agreementVersionIds.length === 3" size="small" color="green">三家一致</a-tag>
                </div>
                <div class="cell-actions">
                  <a-button size="mini" @click.stop="shift(record, 'base', -1)">配对前移</a-button>
                  <a-button size="mini" @click.stop="shift(record, 'base', 1)">配对后移</a-button>
                </div>
              </div>
              <div v-else class="missing-text"><strong>缺句</strong><span>{{ versionName(versions, record.witnessVersionIds.base) }}</span></div>
            </template>

            <template #reference1="{ record }">
              <div v-if="record.reference1" class="witness-cell">
                <div class="paragraph-label">段 {{ record.reference1.paragraphOrder }} · 句 {{ record.reference1.sentenceOrder }}</div>
                <div
                  class="diff-text"
                  :class="{
                    same: record.agreementVersionIds.includes(record.reference1.versionId),
                    changed: !record.agreementVersionIds.includes(record.reference1.versionId),
                    singleton: record.singletonVersionId === record.reference1.versionId
                  }"
                >{{ record.reference1.text }}</div>
                <div class="cell-badges">
                  <a-tag v-if="record.singletonVersionId === record.reference1.versionId" size="small" color="orangered">孤证</a-tag>
                  <a-tag v-else-if="record.agreementVersionIds.includes(record.reference1.versionId) && record.agreementVersionIds.length === 2" size="small" color="arcoblue">多数</a-tag>
                  <a-tag v-else-if="record.agreementVersionIds.length === 3" size="small" color="green">三家一致</a-tag>
                </div>
                <div class="cell-actions">
                  <a-button size="mini" @click.stop="shift(record, 'reference1', -1)">配对前移</a-button>
                  <a-button size="mini" @click.stop="shift(record, 'reference1', 1)">配对后移</a-button>
                </div>
              </div>
              <div v-else class="missing-text"><strong>缺句</strong><span>{{ versionName(versions, record.witnessVersionIds.reference1) }}</span></div>
            </template>

            <template #reference2="{ record }">
              <div v-if="record.reference2" class="witness-cell">
                <div class="paragraph-label">段 {{ record.reference2.paragraphOrder }} · 句 {{ record.reference2.sentenceOrder }}</div>
                <div
                  class="diff-text"
                  :class="{
                    same: record.agreementVersionIds.includes(record.reference2.versionId),
                    changed: !record.agreementVersionIds.includes(record.reference2.versionId),
                    singleton: record.singletonVersionId === record.reference2.versionId
                  }"
                >{{ record.reference2.text }}</div>
                <div class="cell-badges">
                  <a-tag v-if="record.singletonVersionId === record.reference2.versionId" size="small" color="orangered">孤证</a-tag>
                  <a-tag v-else-if="record.agreementVersionIds.includes(record.reference2.versionId) && record.agreementVersionIds.length === 2" size="small" color="arcoblue">多数</a-tag>
                  <a-tag v-else-if="record.agreementVersionIds.length === 3" size="small" color="green">三家一致</a-tag>
                </div>
                <div class="cell-actions">
                  <a-button size="mini" @click.stop="shift(record, 'reference2', -1)">配对前移</a-button>
                  <a-button size="mini" @click.stop="shift(record, 'reference2', 1)">配对后移</a-button>
                </div>
              </div>
              <div v-else class="missing-text"><strong>缺句</strong><span>{{ versionName(versions, record.witnessVersionIds.reference2) }}</span></div>
            </template>

            <template #consensus="{ record }">
              <div class="consensus-box">
                <template v-if="record.agreementVersionIds.length >= 2">
                  <div class="evidence-label">多数一致</div>
                  <div v-for="id in record.agreementVersionIds" :key="id" class="evidence-name">{{ versionName(versions, id) }}</div>
                </template>
                <template v-else-if="record.readingPattern === 'divergent'">
                  <div class="evidence-label danger">三家读法均不同</div>
                  <div class="hint-text">需逐家审读后指定定本</div>
                </template>
                <template v-else>
                  <div class="evidence-label danger">缺句 / 依据不足</div>
                </template>
                <div v-if="record.singletonVersionId" class="singleton-box">
                  <a-tag color="orangered">孤证</a-tag>
                  <span>{{ versionName(versions, record.singletonVersionId) }}</span>
                </div>
                <div v-if="record.missingVersionIds.length" class="missing-list">
                  <span class="evidence-label">缺句：</span>
                  {{ record.missingVersionIds.map((id: string) => versionName(versions, id)).join('、') }}
                </div>
              </div>
            </template>

            <template #adoption="{ record }">
              <div class="adoption-cell">
                <div class="adopted-name">{{ versionName(versions, record.adoptedVersionId) }}</div>
                <div class="radio-stack">
                  <label
                    v-for="entry in witnessEntries(record, versions).filter((item) => item.unit)"
                    :key="entry.key"
                    class="adoption-option"
                  >
                    <input
                      type="radio"
                      name="adoption-table"
                      :checked="record.adoptedVersionId === entry.versionId"
                      @change="selectedRowId = record.id; chooseAdoption(entry.versionId)"
                      @click.stop
                    >
                    <span>采{{ entry.key === 'base' ? '底本' : entry.key === 'reference1' ? '参一' : '参二' }}</span>
                  </label>
                </div>
                <a-tag size="small" :color="needsManual(record) ? 'orangered' : 'green'">
                  {{ needsManual(record) ? '人工确认' : '可接受' }}
                </a-tag>
                <a-button
                  size="mini"
                  status="success"
                  :disabled="!canAcceptRow(record)"
                  @click.stop="acceptRows([record.id])"
                >
                  接受
                </a-button>
              </div>
            </template>

            <template #order="{ record }">
              <a-space direction="vertical" size="mini">
                <a-button size="mini" @click.stop="moveRow(record.id, -1)">上移</a-button>
                <a-button size="mini" @click.stop="moveRow(record.id, 1)">下移</a-button>
              </a-space>
            </template>

            <template #note="{ record }">
              <div class="note-cell">
                <div>{{ record.note || '尚未填写校勘说明' }}</div>
                <div v-if="record.source" class="note-source">来源：{{ record.source }}</div>
                <div class="cell-badges">
                  <a-tag size="small" :color="record.accepted ? 'green' : 'orange'">
                    {{ record.accepted ? '已接受' : '待处理' }}
                  </a-tag>
                  <a-tag v-if="record.manualConfirmed" size="small" color="arcoblue">人工已确认</a-tag>
                </div>
              </div>
            </template>

            <template #empty>
              <a-empty description="没有符合条件的三本对齐记录" />
            </template>
          </a-table>
        </a-card>
      </a-layout-content>

      <a-layout-sider class="right-panel" :width="360">
        <section class="panel-section inspector-heading">
          <h2 class="panel-title" style="margin: 0">校勘详情</h2>
          <a-space v-if="selectedRow" :size="4" wrap>
            <a-tag :color="statusColor(selectedRow.status)">{{ statusLabel(selectedRow.status) }}</a-tag>
            <a-tag :color="patternColor(selectedRow.readingPattern)">{{ readingPatternLabel(selectedRow.readingPattern) }}</a-tag>
          </a-space>
        </section>

        <template v-if="selectedRow">
          <section class="panel-section">
            <div class="detail-label">三份原文依据</div>
            <div v-for="entry in selectedWitnessEntries" :key="entry.key" class="witness-detail">
              <div class="witness-title">
                <span>{{ entry.key === 'base' ? '底本' : entry.key === 'reference1' ? '参校本一' : '参校本二' }}：{{ entry.version?.name }}</span>
                <a-tag
                  v-if="entry.unit && selectedRow.singletonVersionId === entry.versionId"
                  size="small"
                  color="orangered"
                >孤证</a-tag>
                <a-tag
                  v-else-if="entry.unit && selectedRow.agreementVersionIds.includes(entry.versionId)"
                  size="small"
                  color="arcoblue"
                >{{ selectedRow.agreementVersionIds.length === 3 ? '三家一致' : '多数' }}</a-tag>
                <a-tag v-else-if="!entry.unit" size="small" color="red">缺句</a-tag>
              </div>
              <div v-if="entry.unit" class="paragraph-label">段 {{ entry.unit.paragraphOrder }} · 句 {{ entry.unit.sentenceOrder }}</div>
              <div class="diff-text" :class="entry.unit ? (selectedRow.singletonVersionId === entry.versionId ? 'changed singleton' : 'same') : 'missing-panel'">
                {{ entry.unit?.text || '此本无对应句' }}
              </div>
            </div>
          </section>

          <section class="panel-section">
            <div class="detail-label">判断类别（人工可改）</div>
            <a-select :model-value="selectedRow.status" style="width: 100%" @change="updateStatus">
              <a-option value="same">三家相同</a-option>
              <a-option value="changed">异文</a-option>
              <a-option value="missing">缺句</a-option>
              <a-option value="misaligned">疑错位</a-option>
            </a-select>
          </section>

          <section class="panel-section">
            <div class="detail-label">指定定本采用哪一家</div>
            <div class="radio-stack">
              <label v-for="entry in selectedWitnessEntries.filter((item) => item.unit)" :key="entry.key" class="adoption-option">
                <input
                  type="radio"
                  name="adoption-detail"
                  :checked="selectedRow.adoptedVersionId === entry.versionId"
                  @change="chooseAdoption(entry.versionId)"
                >
                <span>采用{{ entry.version?.name }}</span>
              </label>
            </div>
            <div class="adopted-preview">
              <div class="evidence-label">定本文字</div>
              <div>{{ adoptedText }}</div>
            </div>
            <a-alert
              v-if="needsManual(selectedRow)"
              type="warning"
              :show-icon="true"
              style="margin-top: 10px"
            >
              这是三家分歧、缺句、疑错位，或定本采用孤证；必须人工确认后才能接受。
            </a-alert>
            <a-checkbox
              :model-value="selectedRow.manualConfirmed"
              :disabled="!needsManual(selectedRow)"
              style="margin-top: 10px"
              @change="confirmSingleton"
            >
              我已核对三份原文，确认此孤例 / 缺句判断
            </a-checkbox>
          </section>

          <section class="panel-section">
            <div class="detail-label">校勘说明与来源（随三份依据导出）</div>
            <a-textarea
              v-model="noteDraft"
              placeholder="记录多数读法、孤证取舍、缺句或错位判断理由"
              :auto-size="{ minRows: 4, maxRows: 9 }"
            />
            <a-input v-model="sourceDraft" placeholder="来源，如：整理者、刻本页码、出土文献编号" style="margin-top: 10px" />
            <a-button long type="primary" style="margin-top: 10px" @click="saveAnnotation">保存校勘说明</a-button>
          </section>

          <section class="panel-section">
            <div class="detail-label">人工调序</div>
            <div class="manual-grid">
              <a-button @click="moveRow(selectedRow.id, -1)">整行上移</a-button>
              <a-button @click="moveRow(selectedRow.id, 1)">整行下移</a-button>
            </div>
            <a-alert type="info" :show-icon="true" style="margin-top: 10px">
              表格中每家下方的“配对前移/后移”只交换该版本句段；底本和两份参校本原文均不会被改写。
            </a-alert>
          </section>

          <section class="panel-section">
            <a-button
              long
              :status="selectedRow.accepted ? 'normal' : 'success'"
              :type="selectedRow.accepted ? 'outline' : 'primary'"
              :disabled="!selectedRow.accepted && !canAcceptRow(selectedRow)"
              @click="selectedRow.accepted ? updateRow(selectedRow.id, { accepted: false }) : acceptRows([selectedRow.id])"
            >
              {{ selectedRow.accepted ? '撤回接受状态' : '接受这条定本' }}
            </a-button>
            <div v-if="!canAcceptRow(selectedRow) && !selectedRow.accepted" class="hint-text" style="margin-top: 8px">
              请先指定定本；孤例、三家分歧或缺句还需勾选人工确认。
            </div>
          </section>
        </template>

        <div v-else class="inspector-empty">
          <div>
            <div class="empty-mark">择</div>
            <p>选择中间一条三本对齐记录<br />即可指定定本、确认孤证并填写校记</p>
          </div>
        </div>

        <section class="panel-section" style="margin-top: auto">
          <div class="hint-text">
            最近状态：{{ message }}<br />
            比较规则、人工调序、接受状态、定本依据和校记均保存在当前浏览器。
          </div>
        </section>
      </a-layout-sider>
    </a-layout>
  </a-layout>

  <a-modal v-model:visible="importVisible" title="导入同一作品的新版本" width="700px" @ok="confirmImport">
    <a-form :model="importForm" layout="vertical">
      <a-grid :cols="2" :col-gap="12">
        <a-grid-item>
          <a-form-item label="版本名称">
            <a-input v-model="importForm.name" placeholder="如：某刻本 / 某校点本" />
          </a-form-item>
        </a-grid-item>
        <a-grid-item>
          <a-form-item label="来源">
            <a-input v-model="importForm.source" placeholder="馆藏、整理者或文件来源" />
          </a-form-item>
        </a-grid-item>
      </a-grid>
      <a-form-item label="选择文本文件">
        <input ref="fileInput" type="file" accept=".txt,.md,text/plain,text/markdown" @change="handleFile" />
      </a-form-item>
      <a-form-item label="或直接粘贴正文">
        <a-textarea
          v-model="importForm.text"
          placeholder="空行分段；句号、问号、感叹号或分号后自动分句"
          :auto-size="{ minRows: 10, maxRows: 18 }"
        />
      </a-form-item>
      <a-alert type="info" :show-icon="true">导入仅写入当前浏览器；对齐后会作为底本或两份参校本之一，原文不会被自动改写。</a-alert>
    </a-form>
  </a-modal>
</template>
