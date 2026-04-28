/**
 * A CodeMirror 6 extension that provides Firestore-specific autocomplete.
 *
 * Provides completions for:
 * - Collection names (from the tables list)
 * - Field names (from column data, including nested dot-notation paths)
 * - Firestore query methods (.where, .orderBy, .limit, .offset, .get)
 * - Firestore operators (==, !=, <, <=, >, >=, in, not-in, array-contains, array-contains-any)
 *
 * Usage:
 * 1. Create instance: const firestoreHint = firestoreHintExtension()
 * 2. Add to extensions: firestoreHint.extensions
 * 3. Set data providers after editor init:
 *    firestoreHint.setTablesGetter(() => tables)
 *    firestoreHint.setColumnsGetter(async (tableName) => columns)
 */

import {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import {
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { TableOrView } from "@/lib/db/models";
import rawLog from "@bksLogger";

const log = rawLog.scope("FirestoreHint");

// State effects for updating data providers
const setTablesEffect = StateEffect.define<() => TableOrView[]>();
const setColumnsGetterEffect = StateEffect.define<(tableName: string) => Promise<string[] | null>>();

// State fields
const tablesGetterField = StateField.define<(() => TableOrView[]) | null>({
  create() { return null; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setTablesEffect)) return e.value;
    }
    return value;
  },
});

const columnsGetterField = StateField.define<((tableName: string) => Promise<string[] | null>) | null>({
  create() { return null; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setColumnsGetterEffect)) return e.value;
    }
    return value;
  },
});

// Firestore method completions (no leading dot — user has already typed it)
const FIRESTORE_METHODS = [
  { label: "where(", type: "function", detail: "field, op, value", info: "Add a filter constraint" },
  { label: "orderBy(", type: "function", detail: "field, direction?", info: "Sort results by field" },
  { label: "limit(", type: "function", detail: "number", info: "Limit number of results" },
  { label: "offset(", type: "function", detail: "number", info: "Skip number of results" },
  { label: "startAt(", type: "function", detail: "value", info: "Start at a specific value" },
  { label: "startAfter(", type: "function", detail: "value", info: "Start after a specific value" },
  { label: "endAt(", type: "function", detail: "value", info: "End at a specific value" },
  { label: "endBefore(", type: "function", detail: "value", info: "End before a specific value" },
  { label: "get()", type: "function", detail: "", info: "Execute the query" },
  { label: "select(", type: "function", detail: "fields...", info: "Select specific fields" },
];

// Firestore operator completions (for .where() arguments)
const FIRESTORE_OPERATORS = [
  { label: "==", type: "keyword", info: "Equal to" },
  { label: "!=", type: "keyword", info: "Not equal to" },
  { label: "<", type: "keyword", info: "Less than" },
  { label: "<=", type: "keyword", info: "Less than or equal to" },
  { label: ">", type: "keyword", info: "Greater than" },
  { label: ">=", type: "keyword", info: "Greater than or equal to" },
  { label: "in", type: "keyword", info: "Value in array" },
  { label: "not-in", type: "keyword", info: "Value not in array" },
  { label: "array-contains", type: "keyword", info: "Array contains value" },
  { label: "array-contains-any", type: "keyword", info: "Array contains any value" },
];

// Firestore top-level completions
const FIRESTORE_TOP_LEVEL = [
  { label: "db", type: "variable", info: "Firestore database reference" },
  { label: "collection(", type: "function", detail: "name", info: "Reference a collection" },
  { label: "doc(", type: "function", detail: "path", info: "Reference a document" },
];

/**
 * Determine what kind of completion context we're in and provide suggestions.
 */
async function completionSource(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const tablesGetter = context.state.field(tablesGetterField);
  const columnsGetter = context.state.field(columnsGetterField);

  if (!tablesGetter) {
    return null;
  }

  const tables = tablesGetter();

  // Get the text before the cursor
  const pos = context.pos;
  const line = context.state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);

  // 1. After "collection(" — suggest collection names
  const collectionMatch = textBefore.match(/collection\(\s*['"]?(\w*)$/);
  if (collectionMatch) {
    const prefix = collectionMatch[1];
    const collectionNames = tables.map((t) => t.name);
    const filtered = prefix
      ? collectionNames.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()))
      : collectionNames;

    if (filtered.length === 0) return null;

    return {
      from: pos - prefix.length,
      options: filtered.map((name) => ({
        label: name,
        type: "class",
        info: `Collection: ${name}`,
      })),
    };
  }

  // 2. After ".where(" — suggest field names from the current collection
  //    Pattern: collection('name').where( or after .where(...).where(
  const whereFieldMatch = textBefore.match(/\.where\(\s*['"]?(\w[\w.]*)$/);
  if (whereFieldMatch) {
    const prefix = whereFieldMatch[1];
    const collectionName = extractCollectionName(textBefore);
    if (collectionName && columnsGetter) {
      const columns = await columnsGetter(collectionName);
      if (columns && columns.length > 0) {
        const filtered = prefix
          ? columns.filter((c) => c.toLowerCase().startsWith(prefix.toLowerCase()))
          : columns;
        return {
          from: pos - prefix.length,
          options: filtered.map((col) => ({
            label: col,
            type: "property",
            info: `Field: ${col}`,
          })),
        };
      }
    }
    // Fallback: suggest operators if we're after a field name in .where()
    // This handles: .where('field', 'op')
  }

  // 3. After a field name in .where() — suggest operators
  //    Pattern: .where('field', 'op') or .where('field', "op")
  const whereOpMatch = textBefore.match(/\.where\(\s*['"][\w.]+['"]\s*,\s*['"]?(\w[\w-]*)$/);
  if (whereOpMatch) {
    const prefix = whereOpMatch[1];
    const filtered = prefix
      ? FIRESTORE_OPERATORS.filter((op) => op.label.toLowerCase().startsWith(prefix.toLowerCase()))
      : FIRESTORE_OPERATORS;
    return {
      from: pos - prefix.length,
      options: filtered,
    };
  }

  // 4. After ".orderBy(" — suggest field names
  const orderByMatch = textBefore.match(/\.orderBy\(\s*['"]?(\w[\w.]*)$/);
  if (orderByMatch) {
    const prefix = orderByMatch[1];
    const collectionName = extractCollectionName(textBefore);
    if (collectionName && columnsGetter) {
      const columns = await columnsGetter(collectionName);
      if (columns && columns.length > 0) {
        const filtered = prefix
          ? columns.filter((c) => c.toLowerCase().startsWith(prefix.toLowerCase()))
          : columns;
        // Also add 'desc'/'asc' as direction options
        const directionOptions = [
          { label: "asc", type: "keyword", info: "Ascending order" },
          { label: "desc", type: "keyword", info: "Descending order" },
        ];
        return {
          from: pos - prefix.length,
          options: [
            ...filtered.map((col) => ({
              label: col,
              type: "property",
              info: `Field: ${col}`,
            })),
            ...directionOptions,
          ],
        };
      }
    }
  }

  // 5. After a dot following a collection reference — suggest methods
  //    Pattern: collection('name'). or db.collection('name').
  const methodMatch = textBefore.match(/(?:collection\(['"][^'"]+['"]\)|\.get\(\)|\.where\([^)]+\)|\.orderBy\([^)]+\)|\.limit\(\d+\)|\.offset\(\d+\))\s*\.$/);
  if (methodMatch) {
    return {
      from: pos,
      options: FIRESTORE_METHODS,
    };
  }

  // 6. At start of line or after "db." — suggest top-level completions
  const startMatch = textBefore.match(/^\s*(db)?\.?\s*$/);
  if (startMatch) {
    const prefix = textBefore.trim();
    if (prefix === "" || prefix === "db" || prefix === "db.") {
      return {
        from: pos - (prefix.endsWith(".") ? 0 : prefix.replace(/\.$/, "").length),
        options: FIRESTORE_TOP_LEVEL,
      };
    }
  }

  // 7. General collection name completion — when typing a word that could be a collection
  const wordMatch = context.matchBefore(/\w+/);
  if (wordMatch && wordMatch.text.length >= 2) {
    const prefix = wordMatch.text;
    const collectionNames = tables.map((t) => t.name);
    const filtered = collectionNames.filter((n) =>
      n.toLowerCase().startsWith(prefix.toLowerCase())
    );
    if (filtered.length > 0) {
      return {
        from: wordMatch.from,
        options: filtered.map((name) => ({
          label: name,
          type: "class",
          info: `Collection: ${name}`,
        })),
      };
    }
  }

  return null;
}

/**
 * Extract the collection name from a query string like:
 * "db.collection('users').where(...)" → "users"
 */
function extractCollectionName(text: string): string | null {
  const match = text.match(/collection\(\s*['"]([^'"]+)['"]\s*\)/);
  return match ? match[1] : null;
}

export function firestoreHintExtension() {
  let view: EditorView;

  const extensions = [
    tablesGetterField,
    columnsGetterField,
    ViewPlugin.fromClass(
      class {
        constructor(v: EditorView) {
          view = v;
        }
      }
    ),
    EditorState.languageData.of(() => [{
      autocomplete: completionSource,
    }]),
  ];

  function setTablesGetter(getter: () => TableOrView[]) {
    if (!view) {
      log.warn("Calling `setTablesGetter` before extension is initialized.");
      return;
    }
    view.dispatch({ effects: setTablesEffect.of(getter) });
  }

  function setColumnsGetter(getter: (tableName: string) => Promise<string[] | null>) {
    if (!view) {
      log.warn("Calling `setColumnsGetter` before extension is initialized.");
      return;
    }
    view.dispatch({ effects: setColumnsGetterEffect.of(getter) });
  }

  return {
    extensions,
    setTablesGetter,
    setColumnsGetter,
  };
}