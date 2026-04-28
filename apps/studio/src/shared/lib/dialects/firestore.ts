import { ColumnType, DialectData } from "./models";

const types = [
  'string', 'number', 'boolean', 'null', 'map', 'array',
  'timestamp', 'geopoint', 'reference', 'bytes'
]

export const FirestoreData: DialectData = {
  sqlLabel: "code",
  columnTypes: types.map((t) => new ColumnType(t)),
  usesOffsetPagination: false,
  queryDialectOverride: 'generic',
  textEditorMode: 'text/x-javascript',
  rawFilterPlaceholder: "field = value  (e.g. status = active, age > 30)",
  disabledFeatures: {
    manualCommit: true,
    resultEditing: false,
    readOnlyPrimaryKeys: true,
    builderFilters: false,
    shell: true,
    informationSchema: {
      extra: true,
    },
    indexes: true,
    alter: {
      everything: true,
    },
    triggers: true,
    relations: true,
    constraints: {
      onUpdate: true,
      onDelete: true,
    },
    index: {
      id: true,
      desc: true,
      primary: true,
    },
    primary: true,
    defaultValue: true,
    nullable: true,
    createIndex: true,
    comments: true,
    filterWithOR: true,
    backup: true,
    truncateElement: true,
    exportTable: true,
    createTable: false,
    dropTable: false,
    dropSchema: true,
    collations: true,
    importFromFile: true,
    headerSort: false,
    duplicateTable: false,
    export: {
      sql: true,
    },
    schema: true,
    generatedColumns: true,
    transactions: true,
    chunkSizeStream: true,
    binaryColumn: true,
    initialSort: false,
    sqlCreate: true,
    compositeKeys: true,
    schemaValidation: true,
  }
}
