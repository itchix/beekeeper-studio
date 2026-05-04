<template>
  <div
    class="firestore-tree-node"
    :class="{
      'is-expanded': source.expanded,
      'is-editing': editing,
      'is-saving': saving,
      'is-collection': source.type === 'collection',
      'is-document': source.type === 'document',
      'is-field': source.type === 'field',
      'is-subcollection-list': source.type === 'subcollection-list',
    }"
    :style="{ paddingLeft: source.level * 20 + 8 + 'px' }"
    role="treeitem"
    :aria-expanded="source.children ? String(source.expanded) : undefined"
    :aria-level="source.level + 1"
  >
    <!-- Chevron -->
    <span
      v-if="source.type !== 'field'"
      class="chevron"
      :class="{ invisible: !source.children || source.children.length === 0 }"
      @click.stop="onExpand($event, source)"
    >
      <i v-if="source.loading" class="material-icons spinner">sync</i>
      <i v-else class="material-icons">chevron_right</i>
    </span>
    <span v-else class="chevron-spacer" />

    <!-- Icon -->
    <span class="icon">
      <i v-if="source.type === 'collection'" class="material-icons">folder</i>
      <i v-else-if="source.type === 'document'" class="material-icons">description</i>
      <i v-else-if="source.type === 'subcollection-list'" class="material-icons">folder_open</i>
      <i v-else class="material-icons">vpn_key</i>
    </span>

    <!-- Label -->
    <span class="label" :title="source.label">{{ source.label }}</span>

    <!-- Value (fields only) -->
    <span v-if="source.type === 'field' && !editing" class="value-wrap">
      <span class="field-type">{{ source.fieldType }}</span>
      <span
        class="value"
        :class="{ editable: source.isEditable }"
        @dblclick.stop="source.isEditable && startEdit()"
      >{{ source.displayValue }}</span>
    </span>

    <!-- Inline edit mode -->
    <span v-if="editing" class="edit-wrap">
      <input
        v-if="editInputType === 'text'"
        ref="editInput"
        v-model="editValue"
        type="text"
        class="edit-input"
        @keydown.enter="saveEdit"
        @keydown.escape="cancelEdit"
        @blur="saveEdit"
      />
      <input
        v-else-if="editInputType === 'number'"
        ref="editInput"
        v-model.number="editValue"
        type="number"
        class="edit-input"
        @keydown.enter="saveEdit"
        @keydown.escape="cancelEdit"
        @blur="saveEdit"
      />
      <select
        v-else-if="editInputType === 'boolean'"
        ref="editInput"
        v-model="editValue"
        class="edit-input"
        @change="saveEdit"
        @keydown.escape="cancelEdit"
      >
        <option :value="true">true</option>
        <option :value="false">false</option>
      </select>
    </span>

    <!-- Saving spinner -->
    <span v-if="saving" class="saving-spinner">
      <i class="material-icons spinner">sync</i>
    </span>

    <!-- Child count badge -->
    <span v-if="source.childCount != null && !source.expanded" class="child-count">
      {{ source.childCount }}
    </span>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'

interface FirestoreTreeNode {
  id: string
  type: 'collection' | 'document' | 'field' | 'subcollection-list'
  label: string
  collectionName?: string
  docId?: string
  value?: unknown
  displayValue: string
  fieldType?: string
  children?: FirestoreTreeNode[]
  childCount?: number
  expanded: boolean
  loading: boolean
  level: number
  isEditable: boolean
}

export default Vue.extend({
  name: 'FirestoreTreeNode',
  props: {
    source: { type: Object as () => FirestoreTreeNode, required: true },
    onExpand: { type: Function, default: () => {} },
    onEdit: { type: Function, default: () => {} },
  },
  data() {
    return {
      editing: false,
      saving: false,
      editValue: '' as unknown,
    }
  },
  computed: {
    editInputType(): string {
      const ft = this.source.fieldType
      if (ft === 'number' || ft === 'float' || ft === 'integer' || ft === 'int64') return 'number'
      if (ft === 'boolean') return 'boolean'
      return 'text'
    },
  },
  methods: {
    startEdit() {
      this.editValue = this.source.value
      this.editing = true
      this.$nextTick(() => {
        const input = this.$refs.editInput as HTMLElement | undefined
        if (input instanceof HTMLInputElement) {
          input.focus()
          input.select()
        }
      })
    },
    saveEdit() {
      if (!this.editing) return
      this.editing = false
      this.saving = true
      this.onEdit(this.source, this.editValue, (success: boolean) => {
        this.saving = false
        if (!success) {
          this.editValue = this.source.value
        }
      })
    },
    cancelEdit() {
      this.editing = false
      this.editValue = this.source.value
    },
  },
})
</script>

<style lang="scss" scoped>
@import '../../assets/styles/app/variables';

.firestore-tree-node {
  display: flex;
  align-items: center;
  height: 28px;
  line-height: 28px;
  white-space: nowrap;
  cursor: default;
  user-select: none;
  font-size: 13px;

  &:hover {
    background: var(--theme-bg-hover, rgba(128, 128, 128, 0.12));
  }

  &.is-expanded .chevron .material-icons {
    transform: rotate(90deg);
  }
}

.chevron {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;

  .material-icons {
    font-size: 16px;
    transition: transform 0.15s;
    color: var(--theme-text-secondary, #999);
  }

  &.invisible {
    visibility: hidden;
  }

  .spinner {
    animation: spin 1s linear infinite;
  }
}

.chevron-spacer {
  width: 20px;
  flex-shrink: 0;
}

.icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 4px;

  .material-icons {
    font-size: 16px;
    color: var(--theme-text-secondary, #999);
  }

  .is-collection & .material-icons {
    color: var(--theme-primary, #f5a623);
  }
}

.label {
  flex-shrink: 0;
  margin-right: 8px;
  color: var(--theme-text, #ccc);
  overflow: hidden;
  text-overflow: ellipsis;

  .is-collection & {
    font-weight: 600;
  }

  .is-document & {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
}

.value-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.field-type {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--theme-bg-input, rgba(64, 64, 64, 0.3));
  color: var(--theme-text-secondary, #888);
  flex-shrink: 0;
}

.value {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--theme-text, #ccc);
  overflow: hidden;
  text-overflow: ellipsis;

  &.editable {
    cursor: pointer;
    &:hover {
      color: var(--theme-primary, #f5a623);
    }
  }
}

.edit-wrap {
  margin-left: 2px;
}

.edit-input {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  padding: 1px 4px;
  border: 1px solid var(--theme-primary, #f5a623);
  border-radius: 3px;
  background: var(--theme-bg-input, #1e1e1e);
  color: var(--theme-text, #ccc);
  outline: none;
  min-width: 80px;
  max-width: 300px;
}

.saving-spinner {
  margin-left: 4px;
  .material-icons {
    font-size: 14px;
    animation: spin 1s linear infinite;
    color: var(--theme-text-secondary, #999);
  }
}

.child-count {
  margin-left: 4px;
  font-size: 11px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--theme-bg-input, rgba(64, 64, 64, 0.3));
  color: var(--theme-text-secondary, #888);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
