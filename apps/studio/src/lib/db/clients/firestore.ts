import {
  SupportedFeatures,
  TableOrView,
  TableResult,
  OrderBy,
  TableFilter,
  StreamResults,
  NgQueryResult,
  CancelableQuery,
  ExtendedTableColumn,
  TableChanges,
  TableUpdateResult,
  Routine,
  TableIndex,
  TableTrigger,
  TableColumn,
  TablePartition,
  TableProperties,
  DatabaseFilterOptions,
  FilterOptions,
  SchemaFilterOptions,
  PrimaryKeyColumn,
  FieldEditData,
  FieldDescriptor,
  ServerStatistics,
  BksField,
} from "../models";
import {
  AppContextProvider,
  BaseQueryResult,
  BasicDatabaseClient,
  NoOpContextProvider,
} from "./BasicDatabaseClient";
import { IDbConnectionServer } from "../backendTypes";
import {
  IDbConnectionDatabase,
  FirestoreOptions,
  FirestoreAuthType,
  DatabaseElement,
} from "../types";
import { ChangeBuilderBase } from "@shared/lib/sql/change_builder/ChangeBuilderBase";
import { CreateTableSpec, TableKey, AlterTableSpec } from "@shared/lib/dialects/models";
import rawLog from "@bksLogger";
import type { Firestore } from "@google-cloud/firestore";

const log = rawLog.scope("firestore");

type FirestoreQueryResult = BaseQueryResult & {
  rows: any[];
  fields: FieldDescriptor[];
  rowCount: number;
};

const firestoreContext: AppContextProvider = NoOpContextProvider;

export class FirestoreClient extends BasicDatabaseClient<FirestoreQueryResult> {
  private app: { delete(): Promise<void> } | null = null;
  private firestoreDb: Firestore | null = null;
  private firestoreOptions: FirestoreOptions;

  private get firestoreClient(): Firestore {
    if (!this.firestoreDb) throw new Error("Not connected to Firestore");
    return this.firestoreDb;
  }
  /** Tracks which columns (in "table.column" format) are Firestore types that need conversion on save */
  private timestampColumns: Set<string> = new Set();
  private geopointColumns: Set<string> = new Set();
  private referenceColumns: Set<string> = new Set();

  constructor(server: IDbConnectionServer, database: IDbConnectionDatabase) {
    super(null, firestoreContext, server, database);
    this.dialect = "generic";
    this.firestoreOptions = server?.config?.firestoreOptions || {};
  }

  async connect(): Promise<void> {
    await super.connect();

    // Dynamic import to avoid bundling firebase-admin in the renderer
    const { initializeApp, cert, applicationDefault, deleteApp } = await import(
      "firebase-admin/app"
    );
    const { getFirestore } = await import("firebase-admin/firestore");

    const authType =
      this.firestoreOptions?.authType || FirestoreAuthType.ServiceAccount;

    const appName = `bks-firestore-${Date.now()}`;

    if (authType === FirestoreAuthType.ApplicationDefault) {
      this.app = initializeApp({
        credential: applicationDefault(),
        projectId: this.firestoreOptions?.projectId || undefined,
      }, appName);
    } else {
      let serviceAccount: any;

      const jsonStr = this.firestoreOptions?.serviceAccountJson?.trim();
      const filePath = this.firestoreOptions?.serviceAccountPath?.trim();

      if (jsonStr) {
        try {
          serviceAccount = JSON.parse(jsonStr);
        } catch (_e) {
          throw new Error(
            "Invalid service account JSON. Please provide a valid JSON string."
          );
        }
      } else if (filePath) {
        const fs = await import("fs/promises");
        try {
          const content = await fs.readFile(filePath, "utf-8");
          serviceAccount = JSON.parse(content);
        } catch (_e) {
          throw new Error(
            `Could not read service account file: ${filePath}`
          );
        }
      } else {
        throw new Error(
          "Please provide a Service Account JSON key or file path in the connection settings, or switch to Application Default Credentials."
        );
      }

      this.app = initializeApp({
        credential: cert(serviceAccount),
        projectId:
          this.firestoreOptions?.projectId || serviceAccount.project_id,
      }, appName);
    }

    try {
      const databaseId = this.firestoreOptions?.databaseId || "(default)";
      this.firestoreDb = getFirestore(this.app, databaseId);

      // Test the connection by listing collections
      await this.firestoreClient.listCollections();

      this.database.connected = true;
      log.info("Connected to Firestore successfully");
    } catch (err) {
      // Clean up the Firebase app on failure
      try { await deleteApp(this.app); } catch (_) { /* ignore */ }
      this.app = null;
      this.firestoreDb = null;
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.app) {
        const { deleteApp } = await import("firebase-admin/app");
        await deleteApp(this.app);
      }
    } catch (error) {
      log.warn("Error disconnecting from Firestore:", error);
    }
    this.app = null;
    this.firestoreDb = null;
    this.database.connected = false;
    await super.disconnect();
  }

  async versionString(): Promise<string> {
    try {
      const { SDK_VERSION } = await import("firebase-admin/app");
      return `Firestore (firebase-admin v${SDK_VERSION})`;
    } catch {
      return "Firestore";
    }
  }

  async defaultSchema(): Promise<string | null> {
    return null;
  }

  async supportedFeatures(): Promise<SupportedFeatures> {
    return {
      customRoutines: false,
      comments: false,
      properties: false,
      partitions: false,
      editPartitions: false,
      backups: false,
      backDirFormat: false,
      restore: false,
      indexNullsNotDistinct: false,
      transactions: false,
      filterTypes: ["standard"],
    };
  }

  async listTables(_filter?: FilterOptions): Promise<TableOrView[]> {
    const collections = await this.firestoreClient.listCollections();

    return collections.map((c: any) => ({
      name: c.id,
      entityType: "table" as const,
      schema: undefined,
      parenttype: "r" as const,
    }));
  }

  async listViews(_filter?: FilterOptions): Promise<TableOrView[]> {
    return [];
  }

  async listRoutines(_filter?: FilterOptions): Promise<Routine[]> {
    return [];
  }

  async listTableColumns(
    table?: string,
    schema?: string
  ): Promise<ExtendedTableColumn[]> {
    if (!table) return [];

    const snapshot = await this.firestoreClient.collection(table).limit(10).get();

    if (snapshot.empty) {
      return [
        {
          ordinalPosition: 0,
          columnName: "__name__",
          dataType: "string",
          tableName: table,
          schemaName: schema || undefined,
          nullable: true,
          bksField: { name: "__name__", bksType: "UNKNOWN" },
        },
      ];
    }

    const fieldMap = new Map<string, Set<string>>();

    snapshot.forEach((doc: any) => {
      const data = doc.data();
      this.flattenFields(data, fieldMap);
    });

    const columns: ExtendedTableColumn[] = [];
    let ordinalPosition = 1;
    for (const [fieldName, types] of fieldMap) {
      const typeArr = Array.from(types);
      const primaryType = typeArr.length === 1 ? typeArr[0] : typeArr.join(" | ");
      columns.push({
        ordinalPosition: ordinalPosition++,
        columnName: fieldName,
        dataType: primaryType,
        tableName: table,
        schemaName: schema || undefined,
        nullable: true,
        bksField: { name: fieldName, bksType: "UNKNOWN" },
      });

      const columnKey = `${table}.${fieldName}`;
      if (types.has("timestamp")) {
        this.timestampColumns.add(columnKey);
      }
      if (types.has("geopoint")) {
        this.geopointColumns.add(columnKey);
      }
      if (types.has("reference")) {
        this.referenceColumns.add(columnKey);
      }
    }

    columns.unshift({
      ordinalPosition: 0,
      columnName: "__name__",
      dataType: "string",
      tableName: table,
      schemaName: schema || undefined,
      nullable: false,
      bksField: { name: "__name__", bksType: "UNKNOWN" },
    });

    return columns;
  }

  async listTableIndexes(
    _table: string,
    _schema?: string
  ): Promise<TableIndex[]> {
    // Firestore indexes are managed externally; return empty
    return [];
  }

  async listTableTriggers(
    _table: string,
    _schema?: string
  ): Promise<TableTrigger[]> {
    return [];
  }

  async listSchemas(_filter?: SchemaFilterOptions): Promise<string[]> {
    return [];
  }

  async listDatabases(_filter?: DatabaseFilterOptions): Promise<string[]> {
    const databaseId = this.firestoreOptions?.databaseId || "(default)";
    return [databaseId];
  }

  async getTableReferences(
    _table: string,
    _schema?: string
  ): Promise<string[]> {
    return [];
  }

  async getTableKeys(_table: string, _schema?: string): Promise<TableKey[]> {
    return [];
  }

  async getOutgoingKeys(_table: string, _schema?: string): Promise<TableKey[]> {
    return [];
  }

  async getIncomingKeys(_table: string, _schema?: string): Promise<TableKey[]> {
    return [];
  }

  async listTablePartitions(
    _table: string,
    _schema?: string
  ): Promise<TablePartition[]> {
    return [];
  }

  async getTableLength(table?: string, _schema?: string): Promise<number> {
    if (!table) return 0;

    const snapshot = await this.firestoreClient.collection(table).count().get();
    return snapshot.data().count;
  }

  async getTableProperties(
    _table: string,
    _schema?: string
  ): Promise<TableProperties | null> {
    return null;
  }

  async query(
    queryText: string,
    _tabId: number,
    _options?: any
  ): Promise<CancelableQuery> {
    const result = await this.executeFirestoreQuery(queryText);
    return {
      execute: async () => [result],
      cancel: async () => {
        /* no-op */
      },
    };
  }

  async executeQuery(
    queryText: string,
    _options?: any
  ): Promise<NgQueryResult[]> {
    const result = await this.executeFirestoreQuery(queryText);
    return [result];
  }

  async executeCommand(commandText: string): Promise<NgQueryResult[]> {
    return this.executeQuery(commandText);
  }

  async selectTop(
    table: string,
    offset: number,
    limit: number,
    orderBy: OrderBy[],
    filters: string | TableFilter[],
    _schema?: string,
    _selects?: string[]
  ): Promise<TableResult> {
    let query: any = this.firestoreClient.collection(table);

    if (typeof filters === "string" && filters.trim()) {
      const parsed = this.parseRawFilter(filters.trim());
      if (parsed) {
        query = query.where(parsed.field, parsed.op, parsed.value);
      }
    } else if (Array.isArray(filters)) {
      for (const filter of filters) {
        if (filter.type === "raw") {
          const rawValue = typeof filter.value === "string" ? filter.value : "";
          if (rawValue.trim()) {
            const parsed = this.parseRawFilter(rawValue.trim());
            if (parsed) {
              query = query.where(parsed.field, parsed.op, parsed.value);
            }
          }
          continue;
        }
        const { field, op, value } = this.parseFilter(filter);
        if (field && op) {
          query = query.where(field, op, value);
        }
      }
    }

    // Firestore requires orderBy for descending sorts and for startAfter/limit with filters.
    // If no orderBy is specified, default to ascending by document ID.
    if (orderBy && orderBy.length > 0) {
      for (const order of orderBy) {
        const dir = (order.dir || "ASC").toUpperCase() === "DESC" ? "desc" : "asc";
        query = query.orderBy(order.field, dir);
      }
    } else {
      query = query.orderBy("__name__", "asc");
    }

    // Cursor pagination: use startAfter with last doc ID instead of expensive offset()
    if (offset != null && offset !== 0 && typeof offset === "string") {
      try {
        const cursorData = JSON.parse(offset);
        // Must include the collection path for a valid document reference
        const cursorDoc = this.firestoreClient.collection(table).doc(cursorData.__name__);
        const cursorSnapshot = await cursorDoc.get();
        if (cursorSnapshot.exists) {
          query = query.startAfter(cursorSnapshot);
        }
      } catch {
        // If cursor parsing fails, fall back to numeric offset
        const numericOffset = typeof offset === "number" ? offset : parseInt(offset, 10);
        if (numericOffset > 0) {
          query = query.offset(numericOffset);
        }
      }
    } else if (typeof offset === "number" && offset > 0) {
      // Fallback for numeric offsets (e.g. direct API calls)
      query = query.offset(offset);
    }

    query = query.limit(limit);

    const snapshot = await query.get();
    const docs = snapshot.docs;

    const rows = docs.map((doc: any) => {
      const data = doc.data();
      return {
        __name__: doc.id,
        ...this.flattenForTable(data),
      };
    });

    const fields = this.inferBksFields(rows);

    let pageState: string | null = null;
    if (docs.length > 0) {
      const lastDoc = docs[docs.length - 1];
      pageState = JSON.stringify({ __name__: lastDoc.id });
    }

    return {
      result: rows,
      fields,
      pageState,
    } as any;
  }

  async selectTopSql(
    table: string,
    _offset: number,
    limit: number,
    _orderBy: OrderBy[],
    _filters: string | TableFilter[],
    _schema?: string,
    _selects?: string[]
  ): Promise<string> {
    // Return a descriptive pseudo-query for the UI
    return `db.collection('${table}').limit(${limit})`;
  }

  async getQuerySelectTop(
    table: string,
    limit: number,
    _schema?: string
  ): Promise<string> {
    return `db.collection('${table}').limit(${limit})`;
  }

  async selectTopStream(
    _table: string,
    _orderBy: OrderBy[],
    _filters: string | TableFilter[],
    _chunkSize: number,
    _schema?: string
  ): Promise<StreamResults> {
    throw new Error("Streaming is not supported for Firestore");
  }

  async queryStream(_query: string, _chunkSize: number): Promise<StreamResults> {
    throw new Error("Streaming is not supported for Firestore");
  }

  async executeApplyChanges(
    changes: TableChanges,
    _tabId?: number
  ): Promise<TableUpdateResult[]> {
    const results: TableUpdateResult[] = [];

    const { TimestampClass, GeoPointClass } = await this.getFirebaseClasses();

    if (changes.inserts?.length) {
      for (const insert of changes.inserts) {
        for (const row of insert.data) {
          const { __name__, ...data } = row;
          const convertedData = await this.unflattenForFirestore(data);
          const docRef = __name__
            ? this.firestoreClient.collection(insert.table).doc(__name__)
            : this.firestoreClient.collection(insert.table).doc();

          await docRef.set(convertedData);
          results.push({
            primaryKeys: [{ column: "__name__", value: docRef.id }],
            result: { __name__: docRef.id, ...data },
          });
        }
      }
    }

    if (changes.updates?.length) {
      for (const update of changes.updates) {
        const docId = update.primaryKeys.find(
          (pk) => pk.column === "__name__"
        )?.value;
        if (!docId) continue;

        const columnKey = `${update.table}.${update.column}`;
        const isTimestamp = this.timestampColumns.has(columnKey) ||
          update.columnType === "timestamp" ||
          update.columnObject?.dataType === "timestamp";
        const isGeopoint = this.geopointColumns.has(columnKey) ||
          update.columnType === "geopoint" ||
          update.columnObject?.dataType === "geopoint";
        const isReference = this.referenceColumns.has(columnKey) ||
          update.columnType === "reference" ||
          update.columnObject?.dataType === "reference";

        const convertedValue = this.convertValueForSave(
          update.value,
          isTimestamp,
          isGeopoint,
          isReference,
          TimestampClass,
          GeoPointClass
        );
        await this.firestoreClient
          .collection(update.table)
          .doc(docId)
          .update({
            [update.column]: convertedValue,
          });
        results.push({
          primaryKeys: [{ column: "__name__", value: docId }],
          result: { __name__: docId, [update.column]: update.value },
        });
      }
    }

    if (changes.deletes?.length) {
      for (const del of changes.deletes) {
        const docId = del.primaryKeys.find(
          (pk) => pk.column === "__name__"
        )?.value;
        if (!docId) continue;
        await this.firestoreClient.collection(del.table).doc(docId).delete();
        results.push({
          primaryKeys: [{ column: "__name__", value: docId }],
          result: { __name__: docId },
        });
      }
    }

    return results;
  }

  async createDatabase(
    _databaseName: string,
    _charset: string,
    _collation: string
  ): Promise<string> {
    throw new Error(
      "Not supported: Firestore databases are managed through Google Cloud Console"
    );
  }

  async createDatabaseSQL(): Promise<string> {
    throw new Error(
      "Not supported: Firestore databases are managed through Google Cloud Console"
    );
  }

  async createTable(table: CreateTableSpec): Promise<void> {
    // In Firestore, collections are created implicitly when documents are added
    // We create a placeholder document
    await this.firestoreClient.collection(table.table).doc("__placeholder__").set({
      __created__: true,
      __createdAt__: new Date(),
    });
  }

  async dropElement(
    elementName: string,
    typeOfElement: DatabaseElement,
    _schema?: string
  ): Promise<void> {
    if (typeOfElement === DatabaseElement.TABLE) {
      await this.deleteCollection(elementName);
    } else {
      throw new Error(
        `Not supported: Cannot drop ${typeOfElement} in Firestore`
      );
    }
  }

  async truncateElementSql(
    _elementName: string,
    _typeOfElement: DatabaseElement,
    _schema?: string
  ): Promise<string> {
    return "";
  }

  async truncateElement(
    elementName: string,
    typeOfElement: DatabaseElement,
    _schema?: string
  ): Promise<void> {
    if (typeOfElement === DatabaseElement.TABLE) {
      await this.deleteCollection(elementName);
    }
  }

  async getTableCreateScript(table: string, _schema?: string): Promise<string> {
    return `// Firestore collection: ${table}\n// Collections are created implicitly when documents are added`;
  }

  async getViewCreateScript(
    _view: string,
    _schema?: string
  ): Promise<string[]> {
    return ["// Views are not supported in Firestore"];
  }

  async getRoutineCreateScript(
    _routine: string,
    _type: string,
    _schema?: string
  ): Promise<string[]> {
    return ["// Routines are not supported in Firestore"];
  }

  async alterTable(_change: AlterTableSpec): Promise<void> {
    throw new Error("Alter table is not supported for Firestore");
  }

  async setTableDescription(
    _table: string,
    _description: string,
    _schema?: string
  ): Promise<string> {
    throw new Error(
      "Not supported: Firestore does not support table descriptions"
    );
  }

  async setElementNameSql(
    _elementName: string,
    _newElementName: string,
    _typeOfElement: DatabaseElement,
    _schema?: string
  ): Promise<string> {
    throw new Error(
      "Not supported: Firestore does not support renaming collections. Use copy + delete instead."
    );
  }

  async setElementName(
    _elementName: string,
    _newElementName: string,
    _typeOfElement: DatabaseElement,
    _schema?: string
  ): Promise<void> {
    // Firestore doesn't support renaming collections directly
    // We'd need to copy all documents to a new collection and delete the old one
    throw new Error(
      "Not supported: Firestore does not support renaming collections. Use copy + delete instead."
    );
  }

  async duplicateTable(
    tableName: string,
    duplicateTableName: string,
    _schema?: string
  ): Promise<void> {
    const sourceCollection = this.firestoreClient.collection(tableName);
    const destCollection = this.firestoreClient.collection(duplicateTableName);
    const BATCH_SIZE = 500;

    let lastDoc: any = null;
    let hasMore = true;
    while (hasMore) {
      let query = sourceCollection.limit(BATCH_SIZE);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
      const snapshot = await query.get();
      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      const batch = this.firestoreClient.batch();
      snapshot.docs.forEach((doc: any) => {
        batch.set(destCollection.doc(doc.id), doc.data());
      });
      await batch.commit();

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < BATCH_SIZE) {
        hasMore = false;
      }
    }
  }

  async duplicateTableSql(
    _tableName: string,
    _duplicateTableName: string,
    _schema?: string
  ): Promise<string> {
    throw new Error(
      "Not supported: Firestore does not support duplicating collections via SQL"
    );
  }

  async truncateAllTables(_schema?: string): Promise<void> {
    throw new Error(
      "Not supported: Firestore does not support truncating all collections at once"
    );
  }

  async listMaterializedViewColumns(
    _table: string,
    _schema?: string
  ): Promise<TableColumn[]> {
    return [];
  }

  async listMaterializedViews(_filter?: FilterOptions): Promise<TableOrView[]> {
    return [];
  }

  async getPrimaryKey(
    _table: string,
    _schema?: string
  ): Promise<string | null> {
    return "__name__";
  }

  async getPrimaryKeys(
    _table: string,
    _schema?: string
  ): Promise<PrimaryKeyColumn[]> {
    return [{ columnName: "__name__", position: 1 }];
  }

  async getCompletions(_cmd: string): Promise<string[]> {
    return [];
  }

  async getShellPrompt(): Promise<string> {
    return "firestore> ";
  }

  async listCharsets(): Promise<string[]> {
    return [];
  }

  async getDefaultCharset(): Promise<string> {
    return "utf8";
  }

  async listCollations(_charset: string): Promise<string[]> {
    return [];
  }

  async getResultEditData(
    _queryText: string,
    _fields: FieldDescriptor[]
  ): Promise<FieldEditData[]> {
    return [];
  }

  async getQueryForFilter(_filter: TableFilter): Promise<string> {
    return "";
  }

  async getFilteredDataCount(
    _table: string,
    _schema: string | null,
    _filter: string
  ): Promise<string> {
    return "0";
  }

  async getServerStatistics(): Promise<ServerStatistics | null> {
    return null;
  }

  async syncDatabase(): Promise<void> {
    await this.firestoreClient.listCollections();
  }

  async importStepZero(_table: TableOrView): Promise<any> {
    return {};
  }

  async importBeginCommand(
    _table: TableOrView,
    _importOptions?: any
  ): Promise<any> {
    return {};
  }

  async importTruncateCommand(
    _table: TableOrView,
    _importOptions?: any
  ): Promise<any> {
    return {};
  }

  async importLineReadCommand(
    _table: TableOrView,
    _sqlString: string | string[],
    _importOptions?: any
  ): Promise<any> {
    return {};
  }

  async importCommitCommand(
    _table: TableOrView,
    _importOptions?: any
  ): Promise<any> {
    return {};
  }

  async importRollbackCommand(
    _table: TableOrView,
    _importOptions?: any
  ): Promise<any> {
    return {};
  }

  async importFinalCommand(
    _table: TableOrView,
    _importOptions?: any
  ): Promise<any> {
    return {};
  }

  wrapIdentifier(value: string): string {
    return value;
  }

  parseTableColumn(column: any): BksField {
    return {
      name: column.columnName || String(column),
      bksType: "UNKNOWN",
    };
  }

  private async getFirebaseClasses(): Promise<{ TimestampClass: any; GeoPointClass: any }> {
    try {
      const firestoreModule = await import("firebase-admin/firestore");
      return { TimestampClass: firestoreModule.Timestamp, GeoPointClass: firestoreModule.GeoPoint };
    } catch {
      return { TimestampClass: null, GeoPointClass: null };
    }
  }

  private async deleteCollection(collectionPath: string): Promise<void> {
    const collectionRef = this.firestoreClient.collection(collectionPath);
    const BATCH_SIZE = 500;

    let hasMore = true;
    while (hasMore) {
      const snapshot = await collectionRef.limit(BATCH_SIZE).get();
      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      const batch = this.firestoreClient.batch();
      snapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }
  }

  private async executeFirestoreQuery(
    queryText: string
  ): Promise<NgQueryResult> {
    const trimmed = queryText.trim();

    try {
      if (trimmed === "list collections" || trimmed === "show collections") {
        const collections = await this.firestoreClient.listCollections();
        const rows = collections.map((c: any) => ({ collection: c.id }));
        return {
          rows,
          fields: [
            { name: "collection", id: "collection", dataType: "string" },
          ],
          rowCount: rows.length,
        };
      }

      const result = await this.parseAndExecuteQuery(trimmed);
      return result;
    } catch (error) {
      log.error("Firestore query failed:", error);
      throw error;
    }
  }

  private async parseAndExecuteQuery(
    queryText: string
  ): Promise<NgQueryResult> {
    const collectionMatch = queryText.match(
      /db\.collection\(['"]([^'"]+)['"]\)/
    );
    const collectionGroupMatch = queryText.match(
      /db\.collectionGroup\(['"]([^'"]+)['"]\)/
    );

    let query: any;

    if (collectionGroupMatch) {
      query = this.firestoreClient.collectionGroup(collectionGroupMatch[1]);
    } else if (collectionMatch) {
      query = this.firestoreClient.collection(collectionMatch[1]);
    } else {
      // Try to evaluate as a direct collection name
      const simpleMatch = queryText.match(/^['"]([^'"]+)['"]$/);
      if (simpleMatch) {
        query = this.firestoreClient.collection(simpleMatch[1]);
      } else {
        throw new Error(
          "Invalid query format. Use:\n" +
            "  db.collection('name').get()\n" +
            "  db.collection('name').where('field', 'op', value).limit(N).get()\n" +
            "  db.collectionGroup('name').where(...).get()\n" +
            "  list collections"
        );
      }
    }

    const whereRegex =
      /\.where\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\s*\)/g;
    let match;
    while ((match = whereRegex.exec(queryText)) !== null) {
      const [, field, op, valueStr] = match;
      const value = this.parseValue(valueStr.trim());
      query = query.where(field, op, value);
    }

    const orderByRegex =
      /\.orderBy\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?\s*\)/g;
    while ((match = orderByRegex.exec(queryText)) !== null) {
      const [, field, direction] = match;
      query = query.orderBy(field, direction || "asc");
    }

    const limitMatch = queryText.match(/\.limit\(\s*(\d+)\s*\)/);
    if (limitMatch) {
      const limitVal = parseInt(limitMatch[1], 10);
      if (!isNaN(limitVal) && limitVal > 0) query = query.limit(limitVal);
    }

    const offsetMatch = queryText.match(/\.offset\(\s*(\d+)\s*\)/);
    if (offsetMatch) {
      const offsetVal = parseInt(offsetMatch[1], 10);
      if (!isNaN(offsetVal) && offsetVal > 0) query = query.offset(offsetVal);
    }

    const snapshot = await query.get();

    const rows = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        __name__: doc.id,
        ...this.flattenForTable(data),
      };
    });

    const fields = this.inferFieldDescriptors(rows);

    return {
      rows,
      fields,
      rowCount: rows.length,
    };
  }

  private parseValue(valueStr: string): any {
    const trimmed = valueStr.trim();

    if (trimmed === "") return "";
    if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
      return trimmed.slice(1, -1);
    }
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;
    if (!isNaN(Number(trimmed))) return Number(trimmed);

    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  private parseFilter(filter: any): { field: string; op: string; value: any } {
    const field = filter.field || filter.column;
    if (!field) return { field: "", op: "==", value: null };

    const comparisonOp = filter.type !== "filter" ? filter.type : filter.op;

    if (comparisonOp === "is") {
      return { field, op: "==", value: null };
    }
    if (comparisonOp === "is not") {
      return { field, op: "!=", value: null };
    }

    const op = this.translateOperator(comparisonOp);
    // Pass value as-is — let Firestore handle type matching.
    // The UI sends strings, and Firestore will compare against the stored type.
    const value = filter.value;

    return { field, op, value };
  }

  private parseRawFilter(input: string): { field: string; op: string; value: any } | null {
    const match = input.match(/^(\S+)\s*(==|=|!=|<>|<|<=|>|>=)\s*(.+)$/);
    if (!match) return null;

    const [, field, rawOp, rawValue] = match;

    let value: any = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      if (!isNaN(Number(value))) value = Number(value);
      else if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
    }

    const op = this.translateOperator(rawOp);
    return { field, op, value };
  }

  private translateOperator(op: string): string {
    const opMap: Record<string, string> = {
      "=": "==",
      "!=": "!=",
      "<>": "!=",
      "<": "<",
      "<=": "<=",
      ">": ">",
      ">=": ">=",
      like: "==", // Firestore doesn't support LIKE, approximate with ==
      "not like": "!=",
      in: "in",
      is: "==",
      "is not": "!=",
    };
    return opMap[op] || "==";
  }

  private isFirestoreGeoPoint(value: any): boolean {
    return (
      value &&
      typeof value === "object" &&
      typeof value.latitude === "number" &&
      typeof value.longitude === "number"
    );
  }

  private isFirestoreTimestamp(value: any): boolean {
    return (
      value &&
      typeof value === "object" &&
      typeof value.toDate === "function" &&
      typeof value.seconds === "number"
    );
  }

  private flattenForTable(
    data: any,
    prefix: string = ""
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        result[fullKey] = null;
      } else if (value instanceof Date) {
        // Native JS Date — format as readable string
        result[fullKey] = this.formatDate(value);
      } else if (this.isFirestoreTimestamp(value)) {
        // Firestore Timestamp — convert to readable string
        result[fullKey] = this.formatDate((value as any).toDate());
      } else if (this.isFirestoreGeoPoint(value)) {
        // Firestore GeoPoint — format as "lat, lng"
        result[fullKey] = `${(value as any).latitude}, ${(value as any).longitude}`;
      } else if (this.isFirestoreDocumentReference(value)) {
        // Firestore DocumentReference — show the path
        result[fullKey] = (value as any).path;
      } else if (
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        // Nested map — flatten recursively
        Object.assign(result, this.flattenForTable(value, fullKey));
      } else if (Array.isArray(value)) {
        result[fullKey] = JSON.stringify(value);
      } else {
        result[fullKey] = value;
      }
    }

    return result;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  private isFirestoreDocumentReference(value: any): boolean {
    return (
      value &&
      typeof value === "object" &&
      typeof value.path === "string" &&
      typeof value.id === "string" &&
      typeof value.parent === "object"
    );
  }

  private async unflattenForFirestore(
    data: Record<string, any>
  ): Promise<Record<string, any>> {
    const result: Record<string, any> = {};

    const { TimestampClass, GeoPointClass } = await this.getFirebaseClasses();

    for (const [key, value] of Object.entries(data)) {
      if (key === "__name__") continue;

      const parts = key.split(".");
      let current = result;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }

      const lastPart = parts[parts.length - 1];
      const convertedValue = this.convertValueForInsert(value, TimestampClass, GeoPointClass);
      current[lastPart] = convertedValue;
    }

    return result;
  }

  private convertValueForInsert(
    value: any,
    TimestampClass: any,
    GeoPointClass: any
  ): any {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      // Only convert strings that match our formatDate output pattern
      // Format: "YYYY-MM-DD HH:mm:ss.SSS" (what formatDate produces)
      const dateValue = this.parseDateString(value);
      if (dateValue) {
        if (TimestampClass) {
          return TimestampClass.fromDate(dateValue);
        }
        // Firestore SDK auto-converts Date to Timestamp
        return dateValue;
      }

      // GeoPoint format: "lat, lng"
      const geoMatch = value.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (geoMatch && GeoPointClass) {
        return new GeoPointClass(
          parseFloat(geoMatch[1]),
          parseFloat(geoMatch[2])
        );
      }

      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
          return this.convertObjectForSave(parsed, TimestampClass, GeoPointClass);
        }
      } catch {
        // Not JSON, keep as string
      }

      return value;
    }

    return value;
  }

  private convertValueForSave(
    value: any,
    isTimestamp: boolean,
    isGeopoint: boolean,
    isReference: boolean,
    TimestampClass: any,
    GeoPointClass: any
  ): any {
    if (value === null || value === undefined) {
      return null;
    }

    if (isTimestamp && typeof value === "string") {
      const dateValue = this.parseDateString(value);
      if (dateValue) {
        if (TimestampClass) {
          return TimestampClass.fromDate(dateValue);
        }
        // Fallback: Firestore SDK auto-converts Date to Timestamp
        return dateValue;
      }
    }

    if (isGeopoint && typeof value === "string") {
      const geoMatch = value.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (geoMatch && GeoPointClass) {
        return new GeoPointClass(
          parseFloat(geoMatch[1]),
          parseFloat(geoMatch[2])
        );
      }
    }

    if (isReference && typeof value === "string") {
      // DocumentReference paths look like "collection/document"
      const parts = value.split("/");
      if (parts.length >= 2 && parts.length % 2 === 0) {
        try {
          return this.firestoreClient.doc(value);
        } catch {
          // If doc() fails, keep as string
        }
      }
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
          return this.convertObjectForSave(
            parsed,
            TimestampClass,
            GeoPointClass
          );
        }
      } catch {
        // Not JSON, keep as string
      }
    }

    return value;
  }

  private convertObjectForSave(
    obj: any,
    TimestampClass: any,
    GeoPointClass: any
  ): any {
    if (Array.isArray(obj)) {
      return obj.map((v) =>
        this.convertValueForSave(v, false, false, false, TimestampClass, GeoPointClass)
      );
    }

    if (obj !== null && typeof obj === "object") {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.convertValueForSave(v, false, false, false, TimestampClass, GeoPointClass);
      }
      return result;
    }

    return obj;
  }

  private parseDateString(value: string): Date | null {
    const datetimeMatch = value.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
    );
    if (datetimeMatch) {
      const [, y, mo, d, h, mi, s, ms] = datetimeMatch;
      return new Date(
        parseInt(y),
        parseInt(mo) - 1,
        parseInt(d),
        parseInt(h),
        parseInt(mi),
        parseInt(s),
        ms ? parseInt(ms.padEnd(3, "0")) : 0
      );
    }

    const isoMatch = value.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/
    );
    if (isoMatch) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  private flattenFields(
    data: any,
    fieldMap: Map<string, Set<string>>,
    prefix: string = ""
  ): void {
    for (const [key, value] of Object.entries(data)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add("null");
      } else if (this.isFirestoreTimestamp(value)) {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add("timestamp");
      } else if (this.isFirestoreGeoPoint(value)) {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add("geopoint");
      } else if (this.isFirestoreDocumentReference(value)) {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add("reference");
      } else if (value instanceof Date) {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add("timestamp");
      } else if (Array.isArray(value)) {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add("array");
        if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
          this.flattenFields(value[0], fieldMap, `${fullKey}[]`);
        }
      } else if (typeof value === "object" && value !== null) {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add("map");
        this.flattenFields(value, fieldMap, fullKey);
      } else {
        if (!fieldMap.has(fullKey)) fieldMap.set(fullKey, new Set());
        fieldMap.get(fullKey)!.add(typeof value);
      }
    }
  }

  private collectFieldNames(rows: any[]): string[] {
    const fieldSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        fieldSet.add(key);
      }
    }
    return Array.from(fieldSet);
  }

  private inferBksFields(rows: any[]): BksField[] {
    if (rows.length === 0) return [];
    return this.collectFieldNames(rows).map((name) => ({
      name,
      bksType: "UNKNOWN" as const,
    }));
  }

  private inferFieldDescriptors(rows: any[]): FieldDescriptor[] {
    if (rows.length === 0) return [];
    return this.collectFieldNames(rows).map((name) => ({
      name,
      id: name,
      dataType: name === "__name__" ? "string" : "any",
    }));
  }

  // Required by base class but not used for Firestore
  protected async rawExecuteQuery(
    q: string,
    _options: any
  ): Promise<FirestoreQueryResult | FirestoreQueryResult[]> {
    const result = await this.executeFirestoreQuery(q);
    return {
      rows: result.rows || [],
      fields: result.fields || [],
      columns: (result.fields || []).map((f) => ({
        name: f.name,
        type: f.dataType,
      })),
      arrayMode: false,
      rowCount: result.rowCount || 0,
    };
  }

  getBuilder(
    _table: string,
    _schema?: string
  ): ChangeBuilderBase {
    throw new Error("Not supported for Firestore");
  }
}
