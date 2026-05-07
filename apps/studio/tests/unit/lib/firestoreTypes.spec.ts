import { FIRESTORE_TYPES, getFirestoreDefault } from "@/lib/db/firestoreTypes";

describe("FIRESTORE_TYPES", () => {
  it("has 10 entries", () => {
    expect(FIRESTORE_TYPES).toHaveLength(10);
  });

  it("every entry has label, key, and defaultValue function", () => {
    for (const t of FIRESTORE_TYPES) {
      expect(typeof t.label).toBe("string");
      expect(typeof t.key).toBe("string");
      expect(typeof t.defaultValue).toBe("function");
    }
  });
});

describe("getFirestoreDefault", () => {
  it("returns '' for string", () => {
    expect(getFirestoreDefault("string")).toBe("");
  });

  it("returns 0 for double", () => {
    expect(getFirestoreDefault("double")).toBe(0);
  });

  it("returns 0 for integer", () => {
    expect(getFirestoreDefault("integer")).toBe(0);
  });

  it("returns false for boolean", () => {
    expect(getFirestoreDefault("boolean")).toBe(false);
  });

  it("returns null for null", () => {
    expect(getFirestoreDefault("null")).toBeNull();
  });

  it("returns a Date for timestamp", () => {
    expect(getFirestoreDefault("timestamp")).toBeInstanceOf(Date);
  });

  it("returns geopoint object for geopoint", () => {
    expect(getFirestoreDefault("geopoint")).toEqual({ latitude: 0, longitude: 0 });
  });

  it("returns '' for doc_reference", () => {
    expect(getFirestoreDefault("doc_reference")).toBe("");
  });

  it("returns [] for array", () => {
    expect(getFirestoreDefault("array")).toEqual([]);
  });

  it("returns {} for map", () => {
    expect(getFirestoreDefault("map")).toEqual({});
  });

  it("returns undefined for unknown type", () => {
    expect(getFirestoreDefault("unknown_type")).toBeUndefined();
  });
});
