<template>
  <div
    class="firestore-tree-node"
    :class="{
      'is-expanded': source.expanded,
      'is-editing': editing,
      'is-collection': source.type === 'collection',
      'is-document': source.type === 'document',
      'is-field': source.type === 'field',
    }"
    :style="{ paddingLeft: source.level * 20 + 8 + 'px' }"
    role="treeitem"
    :aria-expanded="
      source.children && source.children.length
        ? String(source.expanded)
        : undefined
    "
    :aria-level="source.level + 1"
    @contextmenu.prevent="onRightClick"
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
      <i v-else-if="source.type === 'document'" class="material-icons"
        >description</i
      >
      <i v-else-if="source.type === 'subcollection-list'" class="material-icons"
        >folder_open</i
      >
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
        @click.stop="copyValue"
        @dblclick.stop="source.isEditable && startEdit()"
        >{{ source.displayValue }}</span
      >
    </span>

    <!-- Inline edit mode -->
    <span v-if="editing" class="edit-wrap">
      <input
        v-if="editInputType === 'text'"
        :key="'text-input'"
        ref="editInput"
        v-model="editValue"
        type="text"
        class="edit-input"
        @keydown.enter.prevent.stop="saveEdit"
        @keydown.escape.prevent.stop="cancelEdit"
        @blur="saveEdit"
      />
      <input
        v-else-if="editInputType === 'number'"
        :key="'number-input'"
        ref="editInput"
        v-model.number="editValue"
        type="number"
        class="edit-input"
        @keydown.enter.prevent.stop="saveEdit"
        @keydown.escape.prevent.stop="cancelEdit"
        @blur="saveEdit"
      />
      <select
        v-else-if="editInputType === 'boolean'"
        :key="'boolean-select'"
        ref="editInput"
        v-model="editValue"
        class="edit-input"
        @change="saveEdit"
        @keydown.enter.prevent.stop="saveEdit"
        @blur="saveEdit"
        @keydown.escape.prevent.stop="cancelEdit"
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
    <span
      v-if="source.childCount != null && !source.expanded"
      class="child-count"
    >
      {{ source.childCount }}
    </span>

    <!-- Type context menu -->
    <div
      v-if="contextMenu.visible && source.type === 'field'"
      class="type-context-menu"
      :style="{ position: 'fixed', top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
    >
      <div
        v-for="typeDef in firestoreTypes"
        :key="typeDef.key"
        class="type-menu-item"
        :class="{ active: source.fieldType === typeDef.key }"
        @mousedown.stop="changeType(typeDef)"
      >
        <span class="type-check">{{ source.fieldType === typeDef.key ? "✓" : "" }}</span>
        {{ typeDef.label }}
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { FIRESTORE_TYPES, FirestoreTypeDefinition } from "@/lib/db/firestoreTypes";

interface FirestoreTreeNode {
  id: string;
  type: "collection" | "document" | "field" | "subcollection-list";
  label: string;
  collectionName?: string;
  docId?: string;
  value?: unknown;
  displayValue: string;
  fieldType?: string;
  children?: FirestoreTreeNode[];
  childCount?: number;
  expanded: boolean;
  loading: boolean;
  level: number;
  isEditable: boolean;
}

export default Vue.extend({
  name: "FirestoreTreeNode",
  props: {
    source: { type: Object as () => FirestoreTreeNode, required: true },
    onExpand: { type: Function, default: () => undefined },
    onEdit: { type: Function, default: () => undefined },
  },
  data() {
    return {
      editing: false,
      saving: false,
      editValue: undefined as unknown,
      firestoreTypes: FIRESTORE_TYPES as FirestoreTypeDefinition[],
      contextMenu: { visible: false, x: 0, y: 0 } as { visible: boolean; x: number; y: number },
    };
  },
  computed: {
    editInputType(): string {
      const ft = this.source.fieldType;
      if (
        ft === "number" ||
        ft === "float" ||
        ft === "integer" ||
        ft === "int64"
      )
        return "number";
      if (ft === "boolean") return "boolean";
      return "text";
    },
  },
  methods: {
    startEdit() {
      this.editValue = this.source.value;
      this.editing = true;
      this.$nextTick(() => {
        const input = this.$refs.editInput as HTMLElement | undefined;
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      });
    },
    saveEdit() {
      if (!this.editing) return;
      this.editing = false;
      this.saving = true;
      this.onEdit(this.source, this.editValue, (success: boolean) => {
        this.saving = false;
        if (!success) {
          this.editValue = this.source.value;
        }
      });
    },
    cancelEdit() {
      this.editing = false;
      this.editValue = this.source.value;
    },
    copyValue() {
      const value = this.source.value;
      let text = "";
      if (value === null || value === undefined) {
        text = "null";
      } else if (typeof value === "string") {
        text = value;
      } else if (typeof value === "number" || typeof value === "boolean") {
        text = String(value);
      } else if (value instanceof Date) {
        text = value.toISOString();
      } else {
        try {
          text = JSON.stringify(value);
        } catch {
          text = "[Object]";
        }
      }
      (this as any).$native.clipboard.writeText(text);
    },
    onRightClick(e: MouseEvent) {
      if (this.source.type !== "field") return;
      e.preventDefault();
      this.contextMenu = { visible: true, x: e.clientX, y: e.clientY };
      const close = (ev: MouseEvent) => {
        if (!(ev.target as Element).closest(".type-context-menu")) {
          this.closeContextMenu();
          document.removeEventListener("mousedown", close);
        }
      };
      document.addEventListener("mousedown", close);
    },
    closeContextMenu() {
      this.contextMenu = { visible: false, x: 0, y: 0 };
    },
    changeType(typeDef: FirestoreTypeDefinition) {
      this.closeContextMenu();
      const newValue = typeDef.defaultValue();
      this.saving = true;
      this.onEdit(
        this.source,
        newValue,
        (success: boolean) => {
          this.saving = false;
        },
        typeDef.key
      );
    },
  },
});
</script>

<style lang="scss" scoped>
@use "sass:color";
@import "../../assets/styles/app/_variables";

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
    background: color.adjust($theme-bg, $lightness: 8%);
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
    color: $text-light;
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
    color: $text-light;
  }

  .is-collection & .material-icons {
    color: $theme-primary;
  }
}

.label {
  flex-shrink: 0;
  margin-right: 8px;
  color: $text-dark;
  overflow: hidden;
  text-overflow: ellipsis;

  .is-collection & {
    font-weight: 600;
  }

  .is-document & {
    font-family: monospace;
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
  background: $theme-bg;
  color: $text-light;
  flex-shrink: 0;
}

.value {
  font-family: monospace;
  font-size: 12px;
  color: $text-dark;
  overflow: hidden;
  text-overflow: ellipsis;

  &.editable {
    cursor: pointer;
    &:hover {
      color: $theme-primary;
    }
  }
}

.edit-wrap {
  margin-left: 2px;
}

.edit-input {
  font-family: monospace;
  font-size: 12px;
  padding: 1px 4px;
  border: 1px solid $theme-primary;
  border-radius: 3px;
  background: $theme-bg;
  color: $text-dark;
  outline: none;
  min-width: 80px;
  max-width: 300px;
}

.saving-spinner {
  margin-left: 4px;
  .material-icons {
    font-size: 14px;
    animation: spin 1s linear infinite;
    color: $text-light;
  }
}

.child-count {
  margin-left: 4px;
  font-size: 11px;
  padding: 0 5px;
  border-radius: 8px;
  background: $theme-bg;
  color: $text-light;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.type-context-menu {
  background: $theme-bg;
  border: 1px solid $border-color;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  min-width: 140px;
  padding: 4px 0;
}

.type-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 13px;
  color: $text-dark;
  cursor: pointer;
  user-select: none;

  &:hover,
  &.active {
    background: $theme-primary;
    color: white;
  }
}

.type-check {
  width: 14px;
  font-size: 12px;
  flex-shrink: 0;
}
</style>
