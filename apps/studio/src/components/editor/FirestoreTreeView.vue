<template>
  <div
    class="firestore-tree-view"
    role="tree"
    @keydown="handleKeydown"
    tabindex="0"
  >
    <!-- Toolbar -->
    <div class="tree-toolbar">
      <input
        v-if="mode === 'explorer'"
        v-model="searchText"
        type="text"
        class="search-input"
        placeholder="Filter collections..."
      />
      <span v-else class="tree-title">
        {{ mode === "results" ? `Results (${nodeCount} documents)` : "" }}
      </span>
      <div class="tree-toolbar-actions">
        <button
          v-if="mode === 'explorer'"
          class="btn btn-flat btn-icon"
          title="Refresh"
          @click="rebuild"
        >
          <i class="material-icons">refresh</i>
        </button>
        <button
          class="btn btn-flat btn-icon"
          :title="allExpanded ? 'Collapse all' : 'Expand all'"
          @click="toggleAll"
        >
          <i class="material-icons">{{
            allExpanded ? "unfold_less" : "unfold_more"
          }}</i>
        </button>
      </div>
    </div>

    <!-- Tree body -->
    <div v-if="loading" class="tree-loading">
      <div v-for="n in 4" :key="n" class="skeleton-row">
        <span class="skeleton-bar" :style="{ width: 40 + n * 30 + 'px' }" />
      </div>
    </div>

    <div v-else-if="error" class="tree-error">
      <i class="material-icons">error_outline</i>
      <span>{{ error }}</span>
      <button class="btn btn-flat" @click="rebuild">Retry</button>
    </div>

    <div v-else-if="displayNodes.length === 0" class="tree-empty">
      <span>{{
        mode === "explorer" ? "No collections found" : "No results"
      }}</span>
    </div>

    <template v-else>
      <virtual-list
        ref="vList"
        class="tree-list"
        :data-key="'id'"
        :data-sources="displayNodes"
        :data-component="TreeNode"
        :estimate-size="28"
        :keeps="30"
        :extra-props="extraProps"
      />
      <div v-if="hasMore" class="tree-load-more">
        <button
          class="btn btn-flat btn-small"
          :disabled="loadingMore"
          @click="loadMoreDocuments"
        >
          <i v-if="loadingMore" class="material-icons spinner">sync</i>
          <span>Load more...</span>
        </button>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import VirtualList from "vue-virtual-scroll-list";
import FirestoreTreeNodeComponent from "./FirestoreTreeNode.vue";

interface FirestoreTreeNode {
  id: string;
  parentId?: string;
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

const PAGE_SIZE = 50;

export default Vue.extend({
  name: "FirestoreTreeView",
  components: { VirtualList },
  props: {
    connection: { type: Object, required: true },
    rows: { type: Array, default: () => [] },
    fields: { type: Array, default: () => [] },
    mode: { type: String as () => "explorer" | "results", default: "results" },
    tableName: { type: String, default: "" },
  },
  data() {
    return {
      TreeNode: FirestoreTreeNodeComponent,
      nodes: [] as FirestoreTreeNode[],
      nodeStates: {} as Record<string, { expanded: boolean }>,
      loading: false,
      error: "",
      searchText: "",
      focusedIndex: 0,
      pageCursors: {} as Record<string, string | null>,
      loadingMore: false,
    };
  },
  computed: {
    extraProps() {
      return {
        onExpand: this.handleExpand,
        onEdit: this.handleEdit,
      };
    },
    displayNodes(): FirestoreTreeNode[] {
      const result: FirestoreTreeNode[] = [];
      const query = this.searchText.toLowerCase();
      for (const node of this.nodes) {
        if (!query || node.label.toLowerCase().includes(query)) {
          if (this.isNodeVisible(node)) {
            result.push(node);
          }
        }
      }
      return result;
    },
    nodeCount(): number {
      return this.nodes.filter((n) => n.type === "document").length;
    },
    hasMore(): boolean {
      for (const node of this.nodes) {
        if (
          node.type === "collection" &&
          node.expanded &&
          this.pageCursors[node.collectionName!]
        ) {
          return true;
        }
      }
      return false;
    },
    allExpanded(): boolean {
      const collapsibleNodes = this.nodes.filter(
        (node) => node.type !== "field"
      );
      return (
        collapsibleNodes.length > 0 &&
        collapsibleNodes.every((node) => node.expanded)
      );
    },
    nodeMap(): Map<string, FirestoreTreeNode> {
      const m = new Map<string, FirestoreTreeNode>();
      for (const n of this.nodes) {
        m.set(n.id, n);
      }
      return m;
    },
  },
  watch: {
    rows: {
      handler() {
        this.rebuild({ preserveState: true, preserveSearch: true });
      },
      immediate: true,
    },
    mode: {
      handler() {
        this.rebuild();
      },
    },
  },
  methods: {
    async rebuild(
      options: { preserveState?: boolean; preserveSearch?: boolean } = {}
    ) {
      this.nodes = [];
      if (!options.preserveState) {
        this.nodeStates = {};
      }
      this.error = "";
      if (!options.preserveSearch) {
        this.searchText = "";
      }

      if (this.mode === "results" && this.rows.length > 0) {
        await this.buildFromResults();
      } else if (this.mode === "explorer") {
        await this.buildFromCollections();
      }
    },

    async buildFromCollections() {
      this.loading = true;
      try {
        const tables = await this.connection.listTables();
        const collections = tables.filter((t: any) => t.entityType === "table");
        this.nodes = collections.map((c: any) =>
          this.makeCollectionNode(c.name)
        );
      } catch (err: any) {
        this.error = err.message || "Failed to list collections";
      } finally {
        this.loading = false;
      }
    },

    buildFromResults() {
      const docNodes = (this.rows as any[]).map((row: any, idx: number) => {
        const namePath = row.__name__ || row.id || `doc-${idx}`;
        const parts =
          typeof namePath === "string"
            ? namePath.split("/")
            : [String(namePath)];
        const docId = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
        const collectionName =
          parts.length > 1 ? parts[0] : this.tableName || undefined;
        const docNodeId = `doc:${docId}`;

        const children: FirestoreTreeNode[] = [];
        const sortedFields = [...(this.fields as any[])].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        for (const field of sortedFields) {
          if (field.name === "__name__") continue;
          const rawValue = row[field.name];
          children.push(
            this.makeFieldNode(
              docNodeId,
              docId,
              field.name,
              rawValue,
              field.dataType,
              collectionName
            )
          );
        }

        return {
          id: docNodeId,
          parentId: undefined,
          type: "document" as const,
          collectionName,
          label: typeof docId === "string" ? docId : String(docId),
          displayValue: "",
          children,
          childCount: children.length,
          expanded: this.nodeStates[docNodeId]?.expanded ?? false,
          loading: false,
          level: 0,
          isEditable: false,
        };
      });

      // Flatten: for each doc, insert doc then its field children
      for (const doc of docNodes) {
        this.nodes.push(doc);
        if (doc.children) {
          for (const field of doc.children) {
            this.nodes.push(field);
          }
        }
      }
    },

    makeCollectionNode(name: string): FirestoreTreeNode {
      return {
        id: `col:${name}`,
        parentId: undefined,
        type: "collection",
        label: name,
        collectionName: name,
        displayValue: "",
        expanded: this.nodeStates[`col:${name}`]?.expanded ?? false,
        loading: false,
        level: 0,
        isEditable: false,
      };
    },

    makeDocumentNode(collectionName: string, docData: any): FirestoreTreeNode {
      const docId = docData.__name__ || "unknown";
      const docNodeId = `doc:${collectionName}/${docId}`;
      const children: FirestoreTreeNode[] = [];
      for (const key of Object.keys(docData).sort()) {
        if (key === "__name__") continue;
        children.push(
          this.makeFieldNode(
            docNodeId,
            docId,
            key,
            docData[key],
            typeof docData[key],
            collectionName
          )
        );
      }
      return {
        id: docNodeId,
        parentId: `col:${collectionName}`,
        type: "document",
        label: typeof docId === "string" ? docId : String(docId),
        collectionName,
        docId: typeof docId === "string" ? docId : String(docId),
        displayValue: "",
        children,
        childCount: children.length,
        expanded: this.nodeStates[docNodeId]?.expanded ?? false,
        loading: false,
        level: 1,
        isEditable: false,
      };
    },

    makeFieldNode(
      parentId: string,
      docId: string,
      fieldName: string,
      rawValue: unknown,
      fieldType?: string,
      collectionName?: string
    ): FirestoreTreeNode {
      const normalizedType = fieldType?.toLowerCase() || "";
      const normalizedTypeParts = normalizedType
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      const isTimestamp = (v: any) =>
        v &&
        typeof v === "object" &&
        typeof v.toDate === "function" &&
        typeof v.seconds === "number";
      const isGeoPoint = (v: any) =>
        v &&
        typeof v === "object" &&
        typeof v.latitude === "number" &&
        typeof v.longitude === "number";
      const isEditable =
        [
          "string",
          "number",
          "boolean",
          "null",
          "timestamp",
          "float",
          "integer",
          "int64",
          "geopoint",
        ].some((type) => normalizedTypeParts.includes(type)) ||
        (!normalizedType &&
          !Array.isArray(rawValue) &&
          typeof rawValue !== "object") ||
        isGeoPoint(rawValue);

      let displayValue = "";
      if (rawValue === undefined) {
        displayValue = "undefined";
      } else if (rawValue === null) {
        displayValue = "null";
      } else if (rawValue instanceof Date) {
        displayValue = rawValue.toISOString();
      } else if (isTimestamp(rawValue)) {
        displayValue = (rawValue as any).toDate().toISOString();
      } else if (isGeoPoint(rawValue)) {
        displayValue = `${(rawValue as any).latitude}, ${
          (rawValue as any).longitude
        }`;
      } else if (typeof rawValue === "object") {
        try {
          const s = JSON.stringify(rawValue);
          displayValue = s.length > 80 ? s.slice(0, 80) + "\u2026" : s;
        } catch {
          displayValue = "[Object]";
        }
      } else {
        displayValue = String(rawValue);
      }

      return {
        id: `field:${docId}.${fieldName}`,
        parentId,
        type: "field",
        label: fieldName,
        docId,
        collectionName,
        value: rawValue,
        displayValue,
        fieldType: normalizedType || "string",
        level: 2,
        isEditable,
        expanded: false,
        loading: false,
      };
    },

    async handleExpand(_event: Event, node: FirestoreTreeNode) {
      if (node.type === "field") return;

      node.expanded = !node.expanded;
      this.updateNodeState(node);

      if (
        node.expanded &&
        node.type === "collection" &&
        (!node.children || node.children.length === 0)
      ) {
        await this.loadDocuments(node);
      }

      this.$forceUpdate();
    },

    async loadDocuments(collectionNode: FirestoreTreeNode) {
      const name = collectionNode.collectionName!;
      collectionNode.loading = true;
      this.$forceUpdate();

      try {
        const result = await this.connection.selectTop(
          name,
          null,
          PAGE_SIZE,
          [],
          []
        );
        const rows = result.result || [];
        const docNodes = rows.map((row: any) =>
          this.makeDocumentNode(name, row)
        );
        collectionNode.children = docNodes;
        collectionNode.childCount = docNodes.length;
        this.pageCursors[name] = result.pageState || null;

        // Build flat list: each doc then its field children, batch insert once
        const flatNodes: FirestoreTreeNode[] = [];
        for (const doc of docNodes) {
          flatNodes.push(doc);
          if (doc.children && doc.children.length > 0) {
            for (const field of doc.children) {
              flatNodes.push(field);
            }
          }
        }
        this.insertNodesAfter(collectionNode, flatNodes);
      } catch (err: any) {
        this.error = err.message || `Failed to load ${name}`;
      } finally {
        collectionNode.loading = false;
        this.$forceUpdate();
      }
    },

    async loadMoreDocuments() {
      const collectionsToLoad = this.nodes.filter(
        (n) =>
          n.type === "collection" &&
          n.expanded &&
          this.pageCursors[n.collectionName!]
      );
      if (collectionsToLoad.length === 0) return;

      this.loadingMore = true;

      for (const collectionNode of collectionsToLoad) {
        const name = collectionNode.collectionName!;
        const cursor = this.pageCursors[name]!;
        try {
          const result = await this.connection.selectTop(
            name,
            cursor,
            PAGE_SIZE,
            [],
            []
          );
          const rows = result.result || [];
          if (rows.length === 0) {
            this.pageCursors[name] = null;
            continue;
          }
          const newDocs = rows.map((row: any) =>
            this.makeDocumentNode(name, row)
          );
          const existing = collectionNode.children || [];
          collectionNode.children = [...existing, ...newDocs];
          collectionNode.childCount = collectionNode.children.length;
          this.pageCursors[name] = result.pageState || null;

          // Build flat list: each new doc then its field children, batch insert once
          const flatNodes: FirestoreTreeNode[] = [];
          for (const doc of newDocs) {
            flatNodes.push(doc);
            if (doc.children && doc.children.length > 0) {
              for (const field of doc.children) {
                flatNodes.push(field);
              }
            }
          }
          this.insertNodesAfter(collectionNode, flatNodes);
        } catch (err: any) {
          this.error = err.message || "Failed to load more";
        }
      }

      this.loadingMore = false;
      this.$forceUpdate();
    },

    collapseAll() {
      for (const node of this.nodes) {
        node.expanded = false;
        this.updateNodeState(node);
        if (node.children) {
          for (const child of node.children) {
            child.expanded = false;
          }
        }
      }
      this.$forceUpdate();
    },

    async expandAll() {
      const collectionsToLoad: FirestoreTreeNode[] = [];

      for (const node of this.nodes) {
        if (node.type === "field") continue;

        node.expanded = true;
        this.updateNodeState(node);

        if (
          node.type === "collection" &&
          (!node.children || node.children.length === 0)
        ) {
          collectionsToLoad.push(node);
        }
      }

      for (const collectionNode of collectionsToLoad) {
        await this.loadDocuments(collectionNode);
      }

      for (const node of this.nodes) {
        if (node.type === "field") continue;

        node.expanded = true;
        this.updateNodeState(node);
      }

      this.$forceUpdate();
    },

    async toggleAll() {
      if (this.allExpanded) {
        this.collapseAll();
        return;
      }

      await this.expandAll();
    },

    handleEdit(
      node: FirestoreTreeNode,
      newValue: unknown,
      done: (success: boolean) => void
    ) {
      if (!node.docId || !node.collectionName) {
        done(false);
        return;
      }

      const oldValue = node.value;
      const shouldStageEdit = !!this.$listeners["field-saved"];

      if (shouldStageEdit) {
        node.value = newValue;
        node.displayValue = this.getDisplayValue(newValue);
        this.$emit("field-saved", {
          collectionName: node.collectionName,
          docId: node.docId,
          field: node.label,
          fieldType: node.fieldType,
          oldValue,
          value: newValue,
        });
        done(true);
        return;
      }

      const changes = {
        updates: [
          {
            table: node.collectionName,
            column: node.label,
            value: newValue,
            primaryKeys: [{ column: "__name__", value: node.docId }],
          },
        ],
        inserts: [],
        deletes: [],
      };

      this.connection
        .applyChanges(changes)
        .then(() => {
          node.value = newValue;
          node.displayValue = this.getDisplayValue(newValue);
          this.$emit("field-saved", {
            collectionName: node.collectionName,
            docId: node.docId,
            field: node.label,
            fieldType: node.fieldType,
            oldValue,
            value: newValue,
          });
          done(true);
        })
        .catch(() => {
          done(false);
        });
    },

    insertNodesAfter(parent: FirestoreTreeNode, newNodes: FirestoreTreeNode[]) {
      const parentIdx = this.nodes.findIndex((n) => n.id === parent.id);
      if (parentIdx < 0) {
        this.nodes.push(...newNodes);
        return;
      }
      let insertAfter = parentIdx;
      for (let i = parentIdx + 1; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        let ancestorId = n.parentId;
        while (ancestorId) {
          if (ancestorId === parent.id) {
            insertAfter = i;
            break;
          }
          const ancestor = this.nodes.find((a) => a.id === ancestorId);
          ancestorId = ancestor?.parentId;
        }
      }
      this.nodes.splice(insertAfter + 1, 0, ...newNodes);
    },

    isNodeVisible(node: FirestoreTreeNode): boolean {
      if (node.level === 0) return true;

      let currentId: string | undefined = node.parentId;
      while (currentId) {
        const ancestor = this.nodes.find((n) => n.id === currentId);
        if (!ancestor || !ancestor.expanded) return false;
        currentId = ancestor.parentId;
      }
      return true;
    },

    updateNodeState(node: FirestoreTreeNode) {
      if (!this.nodeStates[node.id]) {
        this.$set(this.nodeStates, node.id, { expanded: node.expanded });
      } else {
        this.nodeStates[node.id].expanded = node.expanded;
      }
    },

    getDisplayValue(rawValue: unknown): string {
      const isTimestamp = (v: any) =>
        v &&
        typeof v === "object" &&
        typeof v.toDate === "function" &&
        typeof v.seconds === "number";
      const isGeoPoint = (v: any) =>
        v &&
        typeof v === "object" &&
        typeof v.latitude === "number" &&
        typeof v.longitude === "number";

      if (rawValue === undefined) {
        return "undefined";
      }

      if (rawValue === null) {
        return "null";
      }

      if (rawValue instanceof Date) {
        return rawValue.toISOString();
      }

      if (isTimestamp(rawValue)) {
        return (rawValue as any).toDate().toISOString();
      }

      if (isGeoPoint(rawValue)) {
        return `${(rawValue as any).latitude}, ${(rawValue as any).longitude}`;
      }

      if (typeof rawValue === "object") {
        try {
          const serialized = JSON.stringify(rawValue);
          return serialized.length > 80
            ? serialized.slice(0, 80) + "\u2026"
            : serialized;
        } catch {
          return "[Object]";
        }
      }

      return String(rawValue);
    },

    handleKeydown(e: KeyboardEvent) {
      const idx = this.focusedIndex;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.focusedIndex = Math.min(idx + 1, this.displayNodes.length - 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.focusedIndex = Math.max(idx - 1, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const node = this.displayNodes[idx];
        if (node && !node.expanded && node.type !== "field") {
          this.handleExpand(e as any, node);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const node = this.displayNodes[idx];
        if (node && node.expanded) {
          this.handleExpand(e as any, node);
        }
      }
    },
  },
});
</script>

<style lang="scss" scoped>
@use "sass:color";
@import "../../assets/styles/app/_variables";

.firestore-tree-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: $theme-bg;
  border: 1px solid $border-color;
  outline: none;

  &:focus {
    border-color: $theme-primary;
  }
}

.tree-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid $border-color;
  gap: 8px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  padding: 2px 8px;
  border: 1px solid $border-color;
  border-radius: 3px;
  background: $theme-bg;
  color: $text-dark;
  font-size: 12px;
  outline: none;

  &:focus {
    border-color: $theme-primary;
  }
}

.tree-title {
  flex: 1;
  font-size: 12px;
  color: $text-light;
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
  background: color.adjust($theme-bg, $lightness: 8%);
  animation: pulse 1.5s ease-in-out infinite;
}

.tree-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: $brand-danger;
  font-size: 13px;
}

.tree-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: $text-light;
  font-size: 13px;
}

.tree-load-more {
  display: flex;
  justify-content: center;
  padding: 4px 0;
  border-top: 1px solid $border-color;
  flex-shrink: 0;

  .spinner {
    animation: spin 1s linear infinite;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.8;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
