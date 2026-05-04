# Firestore Tree View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Firestore collection/document/field tree view as an alternative to the table grid in query tabs, with inline editing support.

**Architecture:** Two new Vue components (`FirestoreTreeView.vue` container + `FirestoreTreeNode.vue` node row) integrated into `TabQueryEditor.vue` via a view-mode toggle. Uses the existing `vue-virtual-scroll-list` for performance and reuses existing `IBasicDatabaseClient` methods (`listTables`, `selectTop`, `applyChanges`) — zero backend changes.

**Tech Stack:** Vue 2.7 + TypeScript, SCSS, vue-virtual-scroll-list (already in project), existing Firestore client

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/studio/src/components/editor/FirestoreTreeNode.vue` | **Create** | Renders one tree row: chevron, icon, label, value. Inline edit mode. |
| `apps/studio/src/components/editor/FirestoreTreeView.vue` | **Create** | Tree container: loads collections/docs, flattens nodes, virtual scroll, search bar. |
| `apps/studio/src/components/TabQueryEditor.vue` | **Modify** | Add view-mode toggle (Grid/Tree), conditional `<firestore-tree-view>`, edit-cell handler. |

---

## Data Model

```typescript
// Defined in FirestoreTreeView.vue (local to the component)
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
```

---

### Task 1: Create `FirestoreTreeNode.vue`

**Files:**
- Create: `apps/studio/src/components/editor/FirestoreTreeNode.vue`

- [ ] **Step 1: Write the component template and script**

```vue
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
```

- [ ] **Step 2: Verify the file has no syntax errors**

```bash
ls -la apps/studio/src/components/editor/FirestoreTreeNode.vue
```

Expected: File exists, ~165 lines.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/components/editor/FirestoreTreeNode.vue
git commit -m "feat: add FirestoreTreeNode component for tree view rows"
```

---

### Task 2: Create `FirestoreTreeView.vue`

**Files:**
- Create: `apps/studio/src/components/editor/FirestoreTreeView.vue`

This is the main container component. It implements the flat+virtual tree pattern from `entity-list`:
1. Maintains a flat `nodes[]` array
2. Filters to `displayNodes[]` (only nodes whose parent chain is expanded)
3. Passes `displayNodes` to `<virtual-list>`
4. Handles expand (lazy-loads children), edit callbacks, search filtering

- [ ] **Step 1: Write the component (part 1 — template)**

```vue
<template>
  <div class="firestore-tree-view" role="tree" @keydown="handleKeydown" tabindex="0">
    <!-- Toolbar -->
    <div class="tree-toolbar">
      <input
        v-if="mode === 'explorer'"
        v-model="searchText"
        type="text"
        class="search-input"
        placeholder="Filter collections..."
        @input="onSearchInput"
      />
      <span v-else class="tree-title">
        {{ mode === 'results' ? `Results (${nodeCount} documents)` : '' }}
      </span>
      <div class="tree-toolbar-actions">
        <button v-if="mode === 'explorer'" class="btn btn-flat btn-icon" title="Refresh" @click="refresh">
          <i class="material-icons">refresh</i>
        </button>
        <button class="btn btn-flat btn-icon" title="Collapse all" @click="collapseAll">
          <i class="material-icons">unfold_less</i>
        </button>
      </div>
    </div>

    <!-- Tree body -->
    <div v-if="loading" class="tree-loading">
      <div v-for="n in 4" :key="n" class="skeleton-row">
        <span class="skeleton-bar" :style="{ width: 40 + (n * 30) + 'px' }" />
      </div>
    </div>

    <div v-else-if="error" class="tree-error">
      <i class="material-icons">error_outline</i>
      <span>{{ error }}</span>
      <button class="btn btn-flat" @click="refresh">Retry</button>
    </div>

    <div v-else-if="displayNodes.length === 0" class="tree-empty">
      <span>{{ mode === 'explorer' ? 'No collections found' : 'No results' }}</span>
    </div>

    <template v-else>
      <virtual-list
        ref="vList"
        class="tree-list"
        :data-key="'id'"
        :data-sources="displayNodes"
        :data-component="() => TreeNode"
        :estimate-size="28"
        :keeps="30"
        :extra-props="extraProps"
      />
      <div v-if="hasMore" class="tree-load-more">
        <button class="btn btn-flat btn-small" :disabled="loadingMore" @click="loadMoreDocuments">
          <i v-if="loadingMore" class="material-icons spinner">sync</i>
          <span>Load more...</span>
        </button>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Write the component (part 2 — script with data model and core logic)**

```vue
<script lang="ts">
import Vue from 'vue'
import VirtualList from 'vue-virtual-scroll-list'
import FirestoreTreeNodeComponent from './FirestoreTreeNode.vue'

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

const PAGE_SIZE = 50

export default Vue.extend({
  name: 'FirestoreTreeView',
  components: { VirtualList },
  props: {
    connection: { type: Object, required: true },
    rows: { type: Array, default: () => [] },
    fields: { type: Array, default: () => [] },
    mode: { type: String as () => 'explorer' | 'results', default: 'results' },
  },
  data() {
    return {
      TreeNode: FirestoreTreeNodeComponent,
      nodes: [] as FirestoreTreeNode[],
      nodeStates: {} as Record<string, { expanded: boolean }>,
      nodeChildren: {} as Record<string, FirestoreTreeNode[]>,
      loading: false,
      error: '',
      searchText: '',
      focusedIndex: 0,
      pageCursors: {} as Record<string, string | null>,
      loadingMore: false,
    }
  },
  computed: {
    extraProps() {
      return {
        onExpand: this.handleExpand,
        onEdit: this.handleEdit,
      }
    },
    displayNodes(): FirestoreTreeNode[] {
      const result: FirestoreTreeNode[] = []
      for (const node of this.nodes) {
        if (!this.searchText || node.label.toLowerCase().includes(this.searchText.toLowerCase())) {
          if (this.isNodeVisible(node)) {
            result.push(node)
          }
        }
      }
      return result
    },
    nodeCount(): number {
      return this.nodes.filter((n) => n.type === 'document').length
    },
    hasMore(): boolean {
      // Check if any expanded collection has more pages (truthy cursor means more data)
      for (const node of this.nodes) {
        if (node.type === 'collection' && node.expanded && this.pageCursors[node.collectionName!]) {
          return true
        }
      }
      return false
    },
  },
  watch: {
    rows: {
      handler() { this.rebuild() },
      immediate: true,
    },
    mode: {
      handler() { this.rebuild() },
    },
  },
  methods: {
    // --- Rebuild ---
    async rebuild() {
      this.nodes = []
      this.nodeStates = {}
      this.nodeChildren = {}
      this.error = ''
      this.searchText = ''

      if (this.mode === 'results' && this.rows.length > 0) {
        await this.buildFromResults()
      } else if (this.mode === 'explorer') {
        await this.buildFromCollections()
      }
    },

    async buildFromCollections() {
      this.loading = true
      try {
        const tables = await this.connection.listTables()
        const collections = tables.filter((t: any) => t.entityType === 'table')
        this.nodes = collections.map((c: any) => this.makeCollectionNode(c.name))
      } catch (err: any) {
        this.error = err.message || 'Failed to list collections'
      } finally {
        this.loading = false
      }
    },

    buildFromResults() {
      const docNodes = (this.rows as any[]).map((row: any, idx: number) => {
        const docId = row.__name__ || row.id || `doc-${idx}`
        const children: FirestoreTreeNode[] = []
        for (const field of (this.fields as any[])) {
          if (field.name === '__name__') continue
          const rawValue = row[field.name]
          children.push(this.makeFieldNode(docId, field.name, rawValue, field.dataType))
        }

        return {
          id: `doc:${docId}`,
          type: 'document' as const,
          label: typeof docId === 'string' ? docId : String(docId),
          displayValue: '',
          children,
          childCount: children.length,
          expanded: false,
          loading: false,
          level: 0,
          isEditable: false,
        }
      })

      this.nodes = docNodes
    },

    // --- Node factory ---
    makeCollectionNode(name: string): FirestoreTreeNode {
      return {
        id: `col:${name}`,
        type: 'collection',
        label: name,
        collectionName: name,
        displayValue: '',
        expanded: false,
        loading: false,
        level: 0,
        isEditable: false,
      }
    },

    makeDocumentNode(collectionName: string, docData: any): FirestoreTreeNode {
      const docId = docData.__name__ || 'unknown'
      const children: FirestoreTreeNode[] = []
      for (const key of Object.keys(docData)) {
        if (key === '__name__') continue
        children.push(this.makeFieldNode(docId, key, docData[key], typeof docData[key]))
      }
      return {
        id: `doc:${collectionName}/${docId}`,
        type: 'document',
        label: typeof docId === 'string' ? docId : String(docId),
        collectionName,
        docId: typeof docId === 'string' ? docId : String(docId),
        displayValue: '',
        children,
        childCount: children.length,
        expanded: false,
        loading: false,
        level: 1,
        isEditable: false,
      }
    },

    makeFieldNode(
      docId: string,
      fieldName: string,
      rawValue: unknown,
      fieldType?: string
    ): FirestoreTreeNode {
      const normalizedType = fieldType?.toLowerCase() || ''
      const isEditable = ['string', 'number', 'boolean', 'null', 'timestamp', 'float', 'integer', 'int64'].includes(
        normalizedType
      ) || !normalizedType

      let displayValue = ''
      if (rawValue === null || rawValue === undefined) {
        displayValue = 'null'
      } else if (rawValue instanceof Date) {
        displayValue = rawValue.toISOString()
      } else if (typeof rawValue === 'object') {
        try {
          const s = JSON.stringify(rawValue)
          displayValue = s.length > 80 ? s.slice(0, 80) + '…' : s
        } catch {
          displayValue = '[Object]'
        }
      } else {
        displayValue = String(rawValue)
      }

      return {
        id: `field:${docId}.${fieldName}`,
        type: 'field',
        label: fieldName,
        docId,
        value: rawValue,
        displayValue,
        fieldType: normalizedType || 'string',
        level: 2,
        isEditable,
        expanded: false,
        loading: false,
      }
    },

    // --- Expand / Collapse ---
    async handleExpand(_event: Event, node: FirestoreTreeNode) {
      if (node.type === 'field') return

      node.expanded = !node.expanded
      this.updateNodeState(node)

      if (node.expanded && node.type === 'collection' && (!node.children || node.children.length === 0)) {
        await this.loadDocuments(node)
      }

      this.$forceUpdate()
    },

    async loadDocuments(collectionNode: FirestoreTreeNode) {
      const name = collectionNode.collectionName!
      collectionNode.loading = true
      this.$forceUpdate()

      try {
        const result = await this.connection.selectTop(name, null, PAGE_SIZE, [], [])
        const rows = result.result || []
        const docNodes = rows.map((row: any) => this.makeDocumentNode(name, row))
        collectionNode.children = docNodes
        collectionNode.childCount = docNodes.length
        this.addChildNodes(collectionNode, docNodes)
        // Save cursor for pagination
        this.pageCursors[name] = result.pageState || null
      } catch (err: any) {
        this.error = err.message || `Failed to load ${name}`
      } finally {
        collectionNode.loading = false
        this.$forceUpdate()
      }
    },

    async loadMoreDocuments() {
      // Find the expanded collection with a cursor
      const collectionNode = this.nodes.find(
        (n) => n.type === 'collection' && n.expanded && this.pageCursors[n.collectionName!]
      )
      if (!collectionNode) return

      const name = collectionNode.collectionName!
      const cursor = this.pageCursors[name]!
      this.loadingMore = true

      try {
        const result = await this.connection.selectTop(name, cursor, PAGE_SIZE, [], [])
        const rows = result.result || []
        const newDocs = rows.map((row: any) => this.makeDocumentNode(name, row))
        // Append to existing children and insert into flat nodes
        const existing = collectionNode.children || []
        collectionNode.children = [...existing, ...newDocs]
        collectionNode.childCount = collectionNode.children.length
        this.addChildNodes(collectionNode, newDocs)
        this.pageCursors[name] = result.pageState || null
      } catch (err: any) {
        this.error = err.message || 'Failed to load more'
      } finally {
        this.loadingMore = false
        this.$forceUpdate()
      }
    },

    collapseAll() {
      for (const node of this.nodes) {
        node.expanded = false
        this.updateNodeState(node)
        if (node.children) {
          for (const child of node.children) {
            child.expanded = false
          }
        }
      }
      this.$forceUpdate()
    },

    // --- Edit ---
    handleEdit(node: FirestoreTreeNode, newValue: unknown, done: (success: boolean) => void) {
      if (!node.docId || !node.collectionName) {
        done(false)
        return
      }

      const changes = {
        updates: [{
          table: node.collectionName,
          column: node.label,
          value: newValue,
          primaryKeys: [{ column: '__name__', value: node.docId }],
        }],
        inserts: [],
        deletes: [],
      }

      this.connection
        .applyChanges(changes)
        .then(() => {
          node.value = newValue
          node.displayValue =
            newValue === null || newValue === undefined
              ? 'null'
              : typeof newValue === 'object'
                ? JSON.stringify(newValue)
                : String(newValue)
          done(true)
        })
        .catch(() => {
          done(false)
        })
    },

    // --- Helpers ---
    addChildNodes(parent: FirestoreTreeNode, children: FirestoreTreeNode[]) {
      const parentIdx = this.nodes.indexOf(parent)
      if (parentIdx >= 0) {
        this.nodes.splice(parentIdx + 1, 0, ...children)
      }
    },

    isNodeVisible(node: FirestoreTreeNode): boolean {
      if (node.level === 0) return true

      for (const potentialParent of this.nodes) {
        if (
          (potentialParent.type === 'collection' || potentialParent.type === 'document') &&
          node.id.startsWith(potentialParent.id + '/') &&
          !potentialParent.expanded
        ) {
          return false
        }
      }
      return true
    },

    updateNodeState(node: FirestoreTreeNode) {
      if (!this.nodeStates[node.id]) {
        this.$set(this.nodeStates, node.id, { expanded: node.expanded })
      } else {
        this.nodeStates[node.id].expanded = node.expanded
      }
    },

    // --- Search (explorer mode) ---
    onSearchInput() {
      this.$forceUpdate()
    },

    // --- Keyboard ---
    handleKeydown(e: KeyboardEvent) {
      const idx = this.focusedIndex
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.focusedIndex = Math.min(idx + 1, this.displayNodes.length - 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        this.focusedIndex = Math.max(idx - 1, 0)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const node = this.displayNodes[idx]
        if (node && !node.expanded && node.type !== 'field') {
          this.handleExpand(e as any, node)
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const node = this.displayNodes[idx]
        if (node && node.expanded) {
          this.handleExpand(e as any, node)
        }
      }
    },

    // --- Refresh ---
    async refresh() {
      await this.rebuild()
    },
  },
})
</script>
```

- [ ] **Step 3: Write the component (part 3 — styles)**

```vue
<style lang="scss" scoped>
@import '../../assets/styles/app/variables';

.firestore-tree-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--theme-bg, #1e1e1e);
  border: 1px solid var(--theme-border, #333);
  outline: none;

  &:focus {
    border-color: var(--theme-primary, #f5a623);
  }
}

.tree-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--theme-border, #333);
  gap: 8px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  padding: 2px 8px;
  border: 1px solid var(--theme-border, #333);
  border-radius: 3px;
  background: var(--theme-bg-input, #1e1e1e);
  color: var(--theme-text, #ccc);
  font-size: 12px;
  outline: none;

  &:focus {
    border-color: var(--theme-primary, #f5a623);
  }
}

.tree-title {
  flex: 1;
  font-size: 12px;
  color: var(--theme-text-secondary, #888);
  padding: 2px 0;
}

.tree-toolbar-actions {
  display: flex;
  gap: 2px;
}

.tree-list {
  flex: 1;
  overflow: auto;
}

.tree-loading {
  padding: 12px 8px;
}

.skeleton-row {
  height: 28px;
  display: flex;
  align-items: center;
  padding-left: 8px;
}

.skeleton-bar {
  height: 12px;
  border-radius: 4px;
  background: var(--theme-bg-hover, rgba(128, 128, 128, 0.12));
  animation: pulse 1.5s ease-in-out infinite;
}

.tree-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--theme-text-error, #e06c75);
  font-size: 13px;
}

.tree-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--theme-text-secondary, #888);
  font-size: 13px;
}

.tree-load-more {
  display: flex;
  justify-content: center;
  padding: 4px 0;
  border-top: 1px solid var(--theme-border, #333);
  flex-shrink: 0;

  .spinner {
    animation: spin 1s linear infinite;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
</style>
```

- [ ] **Step 4: Verify the file**

```bash
ls -la apps/studio/src/components/editor/FirestoreTreeView.vue
wc -l apps/studio/src/components/editor/FirestoreTreeView.vue
```

Expected: File exists, ~330 lines.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/components/editor/FirestoreTreeView.vue
git commit -m "feat: add FirestoreTreeView container component with virtual scrolling"
```

---

### Task 3: Integrate into `TabQueryEditor.vue`

**Files:**
- Modify: `apps/studio/src/components/TabQueryEditor.vue`

Three changes needed:
1. **Import** the two new components (near line 520, alongside the existing `ResultTable` import)
2. **Template** — add view-mode toggle button in toolbar, add `<firestore-tree-view>` as v-else-if branch in results area
3. **Script** — add `viewMode` data, computed `isFirestore`, method to handle `edit-cell` from tree

- [ ] **Step 1: Add import and component registration in `<script>`**

At **line 520** (after `import ResultTable from './editor/ResultTable.vue'`), insert:

```ts
import FirestoreTreeView from './editor/FirestoreTreeView.vue'
```

At **line 554** (the `components:` registration), add `FirestoreTreeView` to the list. The old line:

```ts
components: { ResultTable, ProgressBar, ShortcutHints, QueryEditorStatusBar, ErrorAlert, MergeManager, SqlTextEditor, SurrealTextEditor, BksSuperFormatter },
```

Replace with:

```ts
components: { ResultTable, ProgressBar, ShortcutHints, QueryEditorStatusBar, ErrorAlert, MergeManager, SqlTextEditor, SurrealTextEditor, BksSuperFormatter, FirestoreTreeView },
```

- [ ] **Step 2: Add `viewMode` to `data()` and `isFirestore` to `computed`**

In `data()` (lines 559–630), add `viewMode` at **line 628** (after `resultEditableMap: []` at line 629 — add before the closing `}`):

```ts
viewMode: 'grid' as 'grid' | 'tree',
```

In `computed` (starts line 632), add after `enabled()` at **line 665**:

```ts
isFirestore(): boolean {
  return this.connectionType === 'firestore'
},
```

- [ ] **Step 3: Add view-mode toggle button in the toolbar**

Insert the toggle block **after line 168** (`<div class="expand" />`) and **before line 169** (`<div class="actions btn-group">`):

```vue
        <template v-if="isFirestore">
          <div class="btn-group view-mode-toggle">
            <x-button
              class="btn btn-flat btn-small"
              :class="{ active: viewMode === 'grid' }"
              title="Grid view"
              @click.prevent="viewMode = 'grid'"
            >
              <i class="material-icons">grid_on</i>
            </x-button>
            <x-button
              class="btn btn-flat btn-small"
              :class="{ active: viewMode === 'tree' }"
              title="Tree view"
              @click.prevent="viewMode = 'tree'"
            >
              <i class="material-icons">account_tree</i>
            </x-button>
          </div>
        </template>
```

This inserts between the second `<div class="expand" />` spacer and the Run button group, using the existing `<x-button>` pattern.

- [ ] **Step 4: Add `<firestore-tree-view>` branch in the results area**

In the results area (the `bottom-panel` div, lines 259–337), insert a new branch **after line 267** (`/>` closing `progress-bar`) and **before line 268** (`<result-table>`):

```vue
      <firestore-tree-view
        v-else-if="isFirestore && viewMode === 'tree'"
        ref="treeView"
        :connection="connection"
        :rows="result ? result.rows || [] : []"
        :fields="result ? result.fields || [] : []"
        :mode="(result && result.rows && result.rows.length > 0) ? 'results' : 'explorer'"
        :style="{ height: tableHeight + 'px' }"
      />
```

**How it works in the v-if chain:**
- `progress-bar` (line 263-267) — `v-if="running"` (first in chain)
- **`firestore-tree-view`** — `v-else-if="isFirestore && viewMode === 'tree'"` (new, shows for Firestore in tree mode, regardless of results)
- `result-table` (line 268-281) — `v-else-if="showResultTable"` (unchanged, only reached when not in firestore tree mode)
- `"No Results"` (line 282-290) — `v-else-if="result"` (falls through when tree branch matched)
- etc.

When `viewMode === 'tree'` and Firestore, the tree branch always matches (even if there are no results, showing explorer mode). When `viewMode === 'grid'` or not Firestore, the chain falls through to the existing branches.

- [ ] **Step 5: Verify the integration compiles**

Run the TypeScript compiler check:

```bash
cd apps/studio && npx vue-tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: No new TypeScript errors introduced by the modified components. Some pre-existing errors may appear (skipLibCheck is on).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/components/TabQueryEditor.vue
git commit -m "feat: integrate Firestore tree view toggle into query editor"
```
