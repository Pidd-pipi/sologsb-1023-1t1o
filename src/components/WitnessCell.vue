<script setup lang="ts">
import { computed } from 'vue';
import type { AlignmentRow, WitnessKey } from '../types';

const props = defineProps<{
  row: AlignmentRow;
  witness: WitnessKey;
  shortName: string;
}>();

const emit = defineEmits<{
  shift: [key: WitnessKey, direction: -1 | 1];
}>();

const unit = computed(() => props.row[props.witness]);
const basis = computed(() => {
  if (props.row.missingReaders.includes(props.witness)) return { label: '缺句', color: 'red' as const, tone: 'missing' };
  if (props.row.majorityReaders.includes(props.witness)) return { label: '多数', color: 'green' as const, tone: 'majority' };
  if (props.row.singletonReaders.includes(props.witness)) return { label: '孤例', color: 'purple' as const, tone: 'singleton' };
  return { label: '互异', color: 'orange' as const, tone: 'divergent' };
});
const adopted = computed(() => props.row.adoptedSource === props.witness);
</script>

<template>
  <div v-if="unit" class="witness-cell">
    <div class="witness-head">
      <span class="paragraph-label">段 {{ unit.paragraphOrder }} · 句 {{ unit.sentenceOrder }}</span>
      <span class="witness-actions">
        <a-tag size="small" :color="basis.color">{{ basis.label }}</a-tag>
        <a-tag v-if="adopted" size="small" color="arcoblue">定本</a-tag>
      </span>
    </div>
    <div class="diff-text witness-text" :class="basis.tone">{{ unit.text }}</div>
    <div class="pairing-actions">
      <a-tooltip :content="`仅交换${shortName}的上一句配对`">
        <a-button size="mini" @click.stop="emit('shift', witness, -1)">配上</a-button>
      </a-tooltip>
      <a-tooltip :content="`仅交换${shortName}的下一句配对`">
        <a-button size="mini" @click.stop="emit('shift', witness, 1)">配下</a-button>
      </a-tooltip>
    </div>
  </div>
  <div v-else class="witness-missing">
    <a-tag size="small" color="red">缺句</a-tag>
    <div>此本无对应句段</div>
    <div class="pairing-actions">
      <a-button size="mini" @click.stop="emit('shift', witness, -1)">配上</a-button>
      <a-button size="mini" @click.stop="emit('shift', witness, 1)">配下</a-button>
    </div>
  </div>
</template>
