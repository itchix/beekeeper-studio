import FirestoreTreeView from "@/components/editor/FirestoreTreeView.vue";

describe("FirestoreTreeView", () => {
  describe("undefined display values", () => {
    it('renders undefined fields as "undefined" when building a field node', () => {
      const makeFieldNode = (FirestoreTreeView as any).options.methods
        .makeFieldNode;

      const node = makeFieldNode.call(
        {},
        "doc:users/abc",
        "abc",
        "nickname",
        undefined,
        "string",
        "users"
      );

      expect(node.displayValue).toBe("undefined");
    });

    it('returns "undefined" from getDisplayValue for post-edit rendering', () => {
      const getDisplayValue = (FirestoreTreeView as any).options.methods
        .getDisplayValue;

      expect(getDisplayValue.call({}, undefined)).toBe("undefined");
      expect(getDisplayValue.call({}, null)).toBe("null");
    });
  });
});
