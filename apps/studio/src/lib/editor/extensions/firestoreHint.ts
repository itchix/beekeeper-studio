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

// ── Module-level constants ────────────────────────────────────────────────────

// Regexes pre-compiled once instead of on every keystroke
// Support hyphens in identifiers (Firestore allows them in collection/field names)
const RE_COLLECTION_ARG  = /collection\(\s*['"]?([\w-]*)$/;
const RE_WHERE_FIELD     = /\.where\(\s*['"]?([\w.-]*)$/;
const RE_WHERE_OP        = /\.where\(\s*['"][\w.-]+['"]\s*,\s*['"]?([\w-]*)$/;
const RE_ORDER_BY        = /\.orderBy\(\s*['"]?([\w.-]*)$/;
const RE_METHOD_DOT      = /(?:collection\(['"][^'"]+['"]\)|\.get\(\)|\.where\([^)]*\)|\.orderBy\([^)]*\)|\.limit\(\d+\)|\.offset\(\d+\)|\.select\([^)]*\)|\.startAt\([^)]*\)|\.startAfter\([^)]*\)|\.endAt\([^)]*\)|\.endBefore\([^)]*\))\s*\.$/;
const RE_LINE_START      = /^\s*(db)?\.?\s*$/;
const RE_COLLECTION_NAME = /collection\(\s*['"]([^'"]+)['"]\s*\)/g;

const DIRECTION_OPTIONS = [
  { label: "asc",  type: "keyword", info: "Ascending order"  },
  { label: "desc", type: "keyword", info: "Descending order" },
];

// ── State effects & fields ────────────────────────────────────────────────────

const setTablesEffect = StateEffect.define<() => TableOrView[]>();
const setColumnsGetterEffect = StateEffect.define<(tableName: string) => Promise<string[] | null>>();

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

// ── Static completion options ─────────────────────────────────────────────────

const FIRESTORE_METHODS = [
  { label: "where(",      type: "function", detail: "field, op, value",  info: "Add a filter constraint"      },
  { label: "orderBy(",    type: "function", detail: "field, direction?",  info: "Sort results by field"        },
  { label: "limit(",      type: "function", detail: "number",             info: "Limit number of results"      },
  { label: "offset(",     type: "function", detail: "number",             info: "Skip number of results"       },
  { label: "startAt(",    type: "function", detail: "value",              info: "Start at a specific value"    },
  { label: "startAfter(", type: "function", detail: "value",              info: "Start after a specific value" },
  { label: "endAt(",      type: "function", detail: "value",              info: "End at a specific value"      },
  { label: "endBefore(",  type: "function", detail: "value",              info: "End before a specific value"  },
  { label: "get()",       type: "function", detail: "",                   info: "Execute the query"            },
  { label: "select(",     type: "function", detail: "fields...",          info: "Select specific fields"       },
];

const FIRESTORE_OPERATORS = [
  { label: "==",                  type: "keyword", info: "Equal to"                    },
  { label: "!=",                  type: "keyword", info: "Not equal to"                },
  { label: "<",                   type: "keyword", info: "Less than"                   },
  { label: "<=",                  type: "keyword", info: "Less than or equal to"       },
  { label: ">",                   type: "keyword", info: "Greater than"                },
  { label: ">=",                  type: "keyword", info: "Greater than or equal to"    },
  { label: "in",                  type: "keyword", info: "Value in array"              },
  { label: "not-in",              type: "keyword", info: "Value not in array"          },
  { label: "array-contains",      type: "keyword", info: "Array contains value"        },
  { label: "array-contains-any",  type: "keyword", info: "Array contains any value"    },
];

const FIRESTORE_TOP_LEVEL = [
  { label: "db",          type: "variable", info: "Firestore database reference" },
  { label: "collection(", type: "function", detail: "name", info: "Reference a collection" },
  { label: "doc(",        type: "function", detail: "path", info: "Reference a document"   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the LAST collection name from text, so chained queries
 * like db.collection("users").where(...).db.collection("orders")
 * resolve to "orders" (the one closest to the cursor).
 */
function extractCollectionName(text: string): string | null {
  const matches = [...text.matchAll(RE_COLLECTION_NAME)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

function filterByPrefix<T extends { label: string }>(items: T[], prefix: string): T[] {
  return prefix
    ? items.filter(i => i.label.toLowerCase().startsWith(prefix.toLowerCase()))
    : items;
}

/**
 * Get the full text from the start of the document to the cursor position.
 * This allows multi-line query matching (e.g. chained .where().orderBy()).
 */
function textBeforeCursor(context: CompletionContext): string {
  return context.state.doc.sliceString(0, context.pos);
}

// ── Completion source ─────────────────────────────────────────────────────────

async function completionSource(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const tablesGetter = context.state.field(tablesGetterField);
  const columnsGetter = context.state.field(columnsGetterField);

  if (!tablesGetter) {
    log.warn("Firestore hint called without tablesGetter");
    return null;
  }

  const tables = tablesGetter();
  const pos = context.pos;
  const line = context.state.doc.lineAt(pos);

  // Use full document text for expression matching (supports multi-line queries)
  const fullText = textBeforeCursor(context);
  // Use current line for line-local patterns (collection arg, line start)
  const lineText = line.text.slice(0, pos - line.from);

  // 1. After "collection(" — suggest collection names
  const collectionMatch = lineText.match(RE_COLLECTION_ARG);
  if (collectionMatch) {
    const prefix = collectionMatch[1];
    const options = filterByPrefix(
      tables.map(t => ({ label: t.name, type: "class" as const, info: `Collection: ${t.name}` })),
      prefix
    );
    if (options.length === 0) return null;
    return { from: pos - prefix.length, options };
  }

  // 2. After ".where(" — suggest field names from the current collection
  const whereFieldMatch = lineText.match(RE_WHERE_FIELD);
  if (whereFieldMatch) {
    const prefix = whereFieldMatch[1];
    const collectionName = extractCollectionName(fullText);
    if (collectionName && columnsGetter) {
      try {
        const columns = await columnsGetter(collectionName);
        if (columns && columns.length > 0) {
          return {
            from: pos - prefix.length,
            options: filterByPrefix(
              columns.map(col => ({ label: col, type: "property" as const, info: `Field: ${col}` })),
              prefix
            ),
          };
        }
      } catch (err) {
        log.error("Error fetching columns for Firestore hint:", err);
      }
    }
  }

  // 3. After a field name in .where() — suggest operators
  const whereOpMatch = lineText.match(RE_WHERE_OP);
  if (whereOpMatch) {
    const prefix = whereOpMatch[1];
    return {
      from: pos - prefix.length,
      options: filterByPrefix(FIRESTORE_OPERATORS, prefix),
    };
  }

  // 4. After ".orderBy(" — suggest field names + direction keywords
  const orderByMatch = lineText.match(RE_ORDER_BY);
  if (orderByMatch) {
    const prefix = orderByMatch[1];
    const collectionName = extractCollectionName(fullText);
    if (collectionName && columnsGetter) {
      try {
        const columns = await columnsGetter(collectionName);
        if (columns && columns.length > 0) {
          return {
            from: pos - prefix.length,
            options: [
              ...filterByPrefix(
                columns.map(col => ({ label: col, type: "property" as const, info: `Field: ${col}` })),
                prefix
              ),
              ...DIRECTION_OPTIONS,
            ],
          };
        }
      } catch (err) {
        log.error("Error fetching columns for Firestore hint:", err);
      }
    }
  }

  // 5. After a dot following a collection reference — suggest methods
  //    Use full text to support multi-line chains
  if (fullText.match(RE_METHOD_DOT)) {
    return { from: pos, options: FIRESTORE_METHODS };
  }

  // 6. At start of line or after "db." — suggest top-level completions
  const startMatch = lineText.match(RE_LINE_START);
  if (startMatch) {
    const prefix = lineText.trim();
    if (prefix === "" || prefix === "db" || prefix === "db.") {
      const fromPos = prefix === "db." ? pos : pos - prefix.length;
      return {
        from: fromPos,
        options: FIRESTORE_TOP_LEVEL,
      };
    }
  }

  return null;
}

// ── Public factory ────────────────────────────────────────────────────────────

export function firestoreHintExtension() {
  let view: EditorView | null = null;

  const extensions = [
    tablesGetterField,
    columnsGetterField,
    ViewPlugin.fromClass(
      class {
        constructor(v: EditorView) {
          view = v;
        }
        destroy() {
          view = null;
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