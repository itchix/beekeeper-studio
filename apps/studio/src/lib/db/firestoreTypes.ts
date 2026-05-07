export interface FirestoreTypeDefinition {
  label: string;
  key: string;
  defaultValue: () => unknown;
}

export const FIRESTORE_TYPES: FirestoreTypeDefinition[] = [
  { label: "Boolean",       key: "boolean",       defaultValue: () => false },
  { label: "Double",        key: "double",         defaultValue: () => 0 },
  { label: "Integer",       key: "integer",        defaultValue: () => 0 },
  { label: "String",        key: "string",         defaultValue: () => "" },
  { label: "Timestamp",     key: "timestamp",      defaultValue: () => new Date() },
  { label: "Geopoint",      key: "geopoint",       defaultValue: () => ({ latitude: 0, longitude: 0 }) },
  { label: "Null",          key: "null",           defaultValue: () => null },
  { label: "Doc Reference", key: "doc_reference",  defaultValue: () => "" },
  { label: "Array",         key: "array",          defaultValue: () => [] },
  { label: "Map",           key: "map",            defaultValue: () => ({}) },
];

export function getFirestoreDefault(key: string): unknown {
  return FIRESTORE_TYPES.find((t) => t.key === key)?.defaultValue();
}
