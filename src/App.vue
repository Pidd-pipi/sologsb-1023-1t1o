<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Message } from '@arco-design/web-vue';
import { patternLabel, statusLabel, useCollation } from './composables/useCollation';
import WitnessCell from './components/WitnessCell.vue';
import type { AlignmentRow, DifferenceStatus, ReadingPattern, WitnessKey } from './types';

const {
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
  exportJson
} = useCollation();

const importVisible = ref(false);
const onlyDifferences = ref(false);
const rowQuery = ref('');
const filterMode = ref<'all' | 'singleton' | 'missing' | 'unaccepted'>('all');
const noteDraft = ref('');
const sourceDraft = ref('');
const importForm = ref({ name: '', source: '', text: '' });
const fileInput = ref<HTMLInputElement | null>(null);

const columns = [
  { title: '三家判断', dataIndex: 'status', slotName: 'status', width: 145, fixed: 'left' as const },
  { title: '底本', dataIndex: 'base', slotName: 'base', width: 275 },
  { title: '参校本一', dataIndex: 'referenceA', slotName: 'referenceA', width: 275 },
  { title: '参校本二', dataIndex: 'referenceB', slotName: 'referenceB', width: 275 },
  { title: '多数 / 定本 / 接受', dataIndex: 'decision', slotName: 'decision', width: 255 },
  { title: '校记 / 来源 / 调序', dataIndex: 'note', slotName: 'note', width: 245 }
];

const witnesses: WitnessKey[] = ['base', 'referenceA', 'referenceB'];

const selectedAdoptionRequiresConfirmation = computed(() => {
  if (!selectedRow.value?.adoptedSource) return false;
  return (
    selectedRow.value.singletonReaders.includes(selectedRow.value.adoptedSource) ||
    selectedRow.value.pattern === 'divergent'
  );
});

const filteredRows = computed(() => {
  const query = rowQuery.value.trim().toLocaleLowerCase();
  return rows.value.filter((row) => {
    if (onlyDifferences.value && row.pattern === 'unanimous') return false;
    if (filterMode.value === 'singleton' && row.singletonReaders.length === 0) return false;
    if (filterMode.value === 'missing' && row.missingReaders.length === 0) return false;
    if (filterMode.value === 'unaccepted' && row.accepted) return false;
    if (!query) return true;
    return [
      ...witnesses.map((key) => row[key]?.text),
      row.note,
      row.source,
      statusLabel(row.status),
      patternLabel(row.pattern)
    ]
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
    added: 'green',
    removed: 'red',
    misaligned: 'arcoblue'
  }[status] as 'gray' | 'orange' | 'green' | 'red' | 'arcoblue';
}

function patternColor(pattern: ReadingPattern) {
  return {
    unanimous: 'gray',
    majority: 'green',
    divergent: 'purple'
  }[pattern] as 'gray' | 'green' | 'purple';
}

function rowClass(record: AlignmentRow) {
  return record.id === selectedRowId.value ? 'row-active' : '';
}

function onSelectionChange(keys: (string | number)[]) {
  selectedRowIds.value = keys;
}

function updateStatus(status: unknown) {
  if (!selectedRow.value) return;
  updateRow(selectedRow.value.id, { status: String(status) as DifferenceStatus });
}

function onRowClick(record: Record<string, unknown>) {
  const row = record as unknown as AlignmentRow;
  selectedRowId.value = row.id;
}

function handleShift(record: AlignmentRow, key: WitnessKey, direction: -1 | 1) {
  shiftPairing(record.id, key, direction);
}

function chooseAdoption(source: unknown) {
  if (!selectedRow.value || typeof source !== 'string') return;
  const key = source as WitnessKey;
  if (!selectedRow.value[key]) {
    Message.warning('缺句版本不能作为定本依据');
    return;
  }
  adoptReading(selectedRow.value.id, key);
  if (selectedAdoptionRequiresConfirmation.value) Message.warning('该定本读法未获多数支持，请人工复核后确认');
}

function saveAnnotation() {
  if (!selectedRow.value) return;
  updateRow(selectedRow.value.id, {
    note: noteDraft.value.trim(),
    source: sourceDraft.value.trim()
  });
  Message.success('校勘说明及三份依据已保存');
}

function acceptSelected() {
  if (!selectedRowIds.value.length) return;
  const skipped = acceptRows(selectedRowIds.value.map(String));
  if (skipped > 0) Message.warning(`${skipped} 条孤例、三家互异或未定读法已跳过，请人工确认`);
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
    download('三家校勘记.md', exportMarkdown(), 'text/markdown;charset=utf-8');
  } else {
    download('三家校勘数据.json', exportJson(), 'application/json;charset=utf-8');
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
      <div style="display: flex; align-items: center; gap: 12px; width: 100%">
        <div class="brand-mark">校</div>
        <div>
          <h1 class="brand-title">校异斋 · 三家会校台</h1>
          <div class="brand-subtitle">底本与两份参校本同条对齐，保留三份原文并追踪定本依据</div>
        </div>
        <a-space style="margin-left: auto" wrap>
          <a-button :disabled="!canUndo" @click="undo">撤销</a-button>
          <a-button :disabled="!canRedo" @click="redo">重做</a-button>
          <a-button type="primary" :loading="processing" :disabled="!canAlign" @click="runAlignment()">重新三家对齐</a-button>
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
      <a-layout-sider class="left-panel" :width="300">
        <section class="panel-section">
          <h2 class="panel-title">会同三本</h2>
          <div style="display: grid; gap: 10px">
            <a-select v-model="baseVersionId" aria-label="底本">
              <template #prefix>底本</template>
              <a-option v-for="version in versions" :key="version.id" :value="version.id" :disabled="version.id === referenceAId || version.id === referenceBId">
                {{ version.name }}
              </a-option>
            </a-select>
            <a-select v-model="referenceAId" aria-label="参校本一">
              <template #prefix>参一</template>
              <a-option v-for="version in versions" :key="version.id" :value="version.id" :disabled="version.id === baseVersionId || version.id === referenceBId">
                {{ version.name }}
              </a-option>
            </a-select>
            <a-select v-model="referenceBId" aria-label="参校本二">
              <template #prefix>参二</template>
              <a-option v-for="version in versions" :key="version.id" :value="version.id" :disabled="version.id === baseVersionId || version.id === referenceAId">
                {{ version.name }}
              </a-option>
            </a-select>
            <a-button long type="outline" :disabled="!canAlign" @click="runAlignment()">执行分片自动对齐</a-button>
          </div>
          <a-progress v-if="processing" :percent="progress" size="small" style="margin-top: 12px" />
          <div v-if="processing" style="margin-top: 6px; color: #86909c; font-size: 12px">
            两组配对并行分片计算，长文本不会长时间卡死
          </div>
        </section>

        <section class="panel-section">
          <h2 class="panel-title">比较规则</h2>
          <a-space direction="vertical" fill>
            <a-checkbox
              :model-checked="rules.ignorePunctuation"
              @change="(checked) => { rules.ignorePunctuation = Boolean(checked); recalculate(); }"
            >
              忽略标点差异
            </a-checkbox>
            <a-checkbox
              :model-checked="rules.ignoreVariants"
              @change="(checked) => { rules.ignoreVariants = Boolean(checked); recalculate(); }"
            >
              忽略常见异体字
            </a-checkbox>
          </a-space>
          <div style="margin-top: 10px; color: #86909c; font-size: 12px; line-height: 1.6">
            规则只影响多数、孤例与错位判断，三份原文始终保留；重算进入撤销历史。
          </div>
        </section>

        <section class="panel-section">
          <h2 class="panel-title">处理进度</h2>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-number">{{ differenceCount }}</div>
              <div class="stat-label">非一致读法</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #722ed1">{{ singletonCount }}</div>
              <div class="stat-label">孤例待确认</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #d25f00">{{ unresolvedCount }}</div>
              <div class="stat-label">待校勘</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #f53f3f">{{ missingCount }}</div>
              <div class="stat-label">缺句</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #00875a">{{ acceptedCount }}</div>
              <div class="stat-label">已接受</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">{{ rows.length }}</div>
              <div class="stat-label">对齐句段</div>
            </div>
          </div>
          <a-button long type="primary" status="success" style="margin-top: 12px" :disabled="!unresolvedCount" @click="acceptAll">
            接受多数建议
          </a-button>
          <a-button long style="margin-top: 8px" @click="nextDifference">跳到下一处未接受读法</a-button>
        </section>

        <section class="panel-section">
          <h2 class="panel-title">键盘辅助</h2>
          <div style="color: #4e5969; font-size: 12px; line-height: 2">
            <div><a-tag size="small">Alt ↓</a-tag> 下一处读法</div>
            <div><a-tag size="small">A</a-tag> 接受勾选建议</div>
            <div><a-tag size="small">Ctrl/⌘ Z</a-tag> 撤销</div>
            <div><a-tag size="small">Ctrl/⌘ Y</a-tag> 重做</div>
          </div>
        </section>
      </a-layout-sider>

      <a-layout-content class="center-panel">
        <a-card :bordered="false" style="margin-bottom: 12px">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
            <a-input-search v-model="rowQuery" placeholder="搜索三份原文、校记或来源" allow-clear style="max-width: 340px" />
            <a-select v-model="filterMode" style="width: 150px" aria-label="筛选读法">
              <a-option value="all">全部记录</a-option>
              <a-option value="unaccepted">未接受</a-option>
              <a-option value="singleton">仅孤例</a-option>
              <a-option value="missing">仅缺句</a-option>
            </a-select>
            <a-checkbox v-model="onlyDifferences">隐藏三家一致</a-checkbox>
            <a-tag color="arcoblue">{{ filteredRows.length }} / {{ rows.length }} 行</a-tag>
            <a-tag v-if="singletonCount" color="purple">{{ singletonCount }} 条孤例需人工确认</a-tag>
            <a-button
              v-if="selectedRowIds.length"
              type="primary"
              status="success"
              size="small"
              style="margin-left: auto"
              @click="acceptSelected"
            >
              接受勾选（孤例跳过）
            </a-button>
          </div>
        </a-card>

        <a-card :bordered="false" :body-style="{ padding: 0 }">
          <a-alert :show-icon="processing" :type="unresolvedCount ? 'warning' : 'success'" style="border-radius: 0">
            {{ message }}<span v-if="unresolvedCount"> · {{ unresolvedCount }} 条读法尚未接受</span>
          </a-alert>
          <a-table
            class="virtual-table"
            row-key="id"
            :columns="columns"
            :data="filteredRows"
            :pagination="false"
            :row-selection="rowSelection"
            :row-class="rowClass"
            :scroll="{ x: 1540, y: 'calc(100vh - 260px)' }"
            :virtual-list-props="{ height: 590, threshold: 40 }"
            @selection-change="onSelectionChange"
            @row-click="onRowClick"
          >
            <template #status="{ record }">
              <a-space direction="vertical" size="mini">
                <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
                <a-tag :color="patternColor(record.pattern)">{{ patternLabel(record.pattern) }}</a-tag>
                <div class="mini-metric">平均相似度 {{ Math.round(record.similarity * 100) }}%</div>
                <div v-if="record.manuallyAdjusted" class="manual-flag">人工调整</div>
              </a-space>
            </template>

            <template #base="{ record }">
              <witness-cell :row="record" witness="base" :short-name="witnessShortName('base')" @shift="(key, direction) => handleShift(record, key, direction)" />
            </template>
            <template #referenceA="{ record }">
              <witness-cell :row="record" witness="referenceA" :short-name="witnessShortName('referenceA')" @shift="(key, direction) => handleShift(record, key, direction)" />
            </template>
            <template #referenceB="{ record }">
              <witness-cell :row="record" witness="referenceB" :short-name="witnessShortName('referenceB')" @shift="(key, direction) => handleShift(record, key, direction)" />
            </template>

            <template #decision="{ record }">
              <div class="decision-cell">
                <div v-if="record.majorityReaders.length" class="evidence-line">
                  多数：{{ record.majorityReaders.map(witnessShortName).join('、') }}
                </div>
                <div v-if="record.singletonReaders.length" class="evidence-line singleton-line">
                  孤例：{{ record.singletonReaders.map(witnessShortName).join('、') }}
                </div>
                <div v-if="record.missingReaders.length" class="evidence-line missing-line">
                  缺句：{{ record.missingReaders.map(witnessShortName).join('、') }}
                </div>
                <div v-if="!record.majorityReaders.length && !record.missingReaders.length" class="evidence-line">
                  三家互异，无多数读法
                </div>
                <div class="adopted-line">
                  定本：{{ record.adoptedSource ? witnessShortName(record.adoptedSource) : '未指定' }}
                </div>
                <a-button size="mini" type="primary" status="success" :disabled="record.accepted" @click.stop="quickAccept(record)">
                  {{ record.accepted ? '已接受' : '接受建议' }}
                </a-button>
              </div>
            </template>

            <template #note="{ record }">
              <div class="note-cell">
                <div>{{ record.note || '尚未填写校勘说明' }}</div>
                <div v-if="record.source" class="note-source">来源：{{ record.source }}</div>
                <div class="note-tags">
                  <a-tag size="small" :color="record.accepted ? 'green' : 'orange'">
                    {{ record.accepted ? (record.manuallyConfirmed ? '已确认' : '已接受') : '待处理' }}
                  </a-tag>
                  <a-button size="mini" @click.stop="moveRow(record.id, -1)">行上移</a-button>
                  <a-button size="mini" @click.stop="moveRow(record.id, 1)">行下移</a-button>
                </div>
              </div>
            </template>

            <template #empty>
              <a-empty description="没有符合条件的三家对齐行" />
            </template>
          </a-table>
        </a-card>
      </a-layout-content>

      <a-layout-sider class="right-panel" :width="380">
        <section class="panel-section">
          <div style="display: flex; align-items: center">
            <h2 class="panel-title" style="margin: 0">校勘详情</h2>
            <a-space v-if="selectedRow" size="mini" style="margin-left: auto">
              <a-tag size="small" :color="statusColor(selectedRow.status)">{{ statusLabel(selectedRow.status) }}</a-tag>
              <a-tag size="small" :color="patternColor(selectedRow.pattern)">{{ patternLabel(selectedRow.pattern) }}</a-tag>
            </a-space>
          </div>
        </section>

        <template v-if="selectedRow">
          <section class="panel-section">
            <div style="margin-bottom: 10px; color: #86909c; font-size: 12px">指定定本采用哪一家</div>
            <a-radio-group
              class="adoption-radio"
              direction="vertical"
              :model-value="selectedRow.adoptedSource"
              @change="chooseAdoption"
            >
              <a-radio v-for="key in witnesses" :key="key" :value="key" :disabled="!selectedRow[key]">
                {{ witnessName(key) }}
                <a-tag
                  size="small"
                  :color="selectedRow.majorityReaders.includes(key) ? 'green' : selectedRow.singletonReaders.includes(key) ? 'purple' : selectedRow.missingReaders.includes(key) ? 'red' : 'orange'"
                >
                  {{ selectedRow.majorityReaders.includes(key) ? '多数' : selectedRow.singletonReaders.includes(key) ? '孤例' : selectedRow.missingReaders.includes(key) ? '缺句' : '互异' }}
                </a-tag>
              </a-radio>
            </a-radio-group>
            <div v-if="selectedRow.adoptedText" class="final-text">
              <div class="final-label">定本正文</div>
              <div
                class="diff-text"
                :class="selectedAdoptionRequiresConfirmation ? 'singleton' : 'majority'"
              >
                {{ selectedRow.adoptedText }}
              </div>
            </div>
            <a-alert
              v-if="selectedAdoptionRequiresConfirmation && !selectedRow.accepted"
              type="warning"
              style="margin-top: 10px"
            >
              定本采用孤例或三家互异读法，必须人工复核后确认。
            </a-alert>
            <a-button
              long
              type="primary"
              style="margin-top: 10px"
              :status="selectedRow.accepted ? 'normal' : 'success'"
              :disabled="!selectedRow.adoptedSource"
              @click="confirmAdoption(selectedRow.id, !selectedRow.accepted)"
            >
              {{ selectedRow.accepted ? '撤回接受状态' : '人工确认接受定本' }}
            </a-button>
          </section>

          <section class="panel-section">
            <div style="margin-bottom: 10px; color: #86909c; font-size: 12px">三份原文依据</div>
            <div v-for="key in witnesses" :key="key" class="detail-witness">
              <div class="detail-witness-title">
                <strong>{{ witnessName(key) }}</strong>
                <a-tag
                  size="small"
                  :color="selectedRow.majorityReaders.includes(key) ? 'green' : selectedRow.singletonReaders.includes(key) ? 'purple' : selectedRow.missingReaders.includes(key) ? 'red' : 'gray'"
                >
                  {{ selectedRow.majorityReaders.includes(key) ? '多数一致' : selectedRow.singletonReaders.includes(key) ? '仅一家不同' : selectedRow.missingReaders.includes(key) ? '缺句' : '三家互异' }}
                </a-tag>
              </div>
              <div class="diff-text" :class="selectedRow.majorityReaders.includes(key) ? 'majority' : selectedRow.singletonReaders.includes(key) ? 'singleton' : selectedRow.missingReaders.includes(key) ? 'missing' : 'divergent'">
                {{ selectedRow[key]?.text || '（此本缺句）' }}
              </div>
            </div>
          </section>

          <section class="panel-section">
            <div style="margin-bottom: 10px; color: #86909c; font-size: 12px">判断类别</div>
            <a-select :model-value="selectedRow.status" style="width: 100%" @change="updateStatus">
              <a-option value="same">三家相同</a-option>
              <a-option value="changed">异文</a-option>
              <a-option value="added">底本缺句</a-option>
              <a-option value="removed">参校缺句</a-option>
              <a-option value="misaligned">疑错位</a-option>
            </a-select>
          </section>

          <section class="panel-section">
            <div style="margin-bottom: 10px; color: #86909c; font-size: 12px">校勘说明与来源依据</div>
            <a-textarea
              v-model="noteDraft"
              placeholder="记录字形、词句、标点、缺句或多数/孤例判断依据"
              :auto-size="{ minRows: 4, maxRows: 9 }"
            />
            <a-input v-model="sourceDraft" placeholder="来源，如：某刻本、出土本、整理者" style="margin-top: 10px" />
            <a-button long type="primary" style="margin-top: 10px" @click="saveAnnotation">保存校勘说明</a-button>
          </section>

          <section class="panel-section">
            <div style="margin-bottom: 10px; color: #86909c; font-size: 12px">人工调序（仅移动该本配对，不改原文）</div>
            <div v-for="key in witnesses" :key="key" class="adjust-row">
              <span>{{ witnessShortName(key) }}</span>
              <a-button size="mini" @click="shiftPairing(selectedRow.id, key, -1)">配对向前</a-button>
              <a-button size="mini" @click="shiftPairing(selectedRow.id, key, 1)">配对向后</a-button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px">
              <a-button @click="moveRow(selectedRow.id, -1)">整条上移</a-button>
              <a-button @click="moveRow(selectedRow.id, 1)">整条下移</a-button>
            </div>
          </section>
        </template>

        <div v-else class="inspector-empty">
          <div>
            <div style="font-size: 30px; color: #c9cdd4">择</div>
            <p>点选一条三家对齐记录<br />指定定本、确认孤例并补写校记</p>
          </div>
        </div>

        <section class="panel-section" style="margin-top: auto">
          <div style="color: #86909c; font-size: 11px; line-height: 1.7">
            最近状态：{{ message }}<br />
            版本、规则、人工调序、接受状态和三份依据均保存在当前浏览器。
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
          placeholder="空行分段；句号、问号、感叹号后自动分句"
          :auto-size="{ minRows: 10, maxRows: 18 }"
        />
      </a-form-item>
      <a-alert type="info" :show-icon="true">导入仅写入当前浏览器。对齐过程会分片执行，三份原文均不会被自动改写。</a-alert>
    </a-form>
  </a-modal>
</template>
