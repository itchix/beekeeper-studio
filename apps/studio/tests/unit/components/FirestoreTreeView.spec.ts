import { shallowMount } from "@vue/test-utils";
import FirestoreTreeView from "@/components/editor/FirestoreTreeView.vue";

const mockConnection = { listTables: jest.fn().mockResolvedValue([]) };

function makeWrapper(propsData = {}) {
  return shallowMount(FirestoreTreeView, {
    propsData: {
      connection: mockConnection,
      rows: [],
      fields: [],
      mode: "results",
      ...propsData,
    },
  });
}

describe("FirestoreTreeView nodeMap", () => {
  it("returns an empty Map when nodes is empty", () => {
    const wrapper = makeWrapper();
    const vm = wrapper.vm as any;
    expect(vm.nodeMap).toBeInstanceOf(Map);
    expect(vm.nodeMap.size).toBe(0);
  });

  it("maps each node id to its node", async () => {
    const wrapper = makeWrapper();
    const vm = wrapper.vm as any;
    vm.nodes = [
      { id: "doc:a", type: "document", expanded: false, level: 0, parentId: undefined },
      { id: "field:a.x", type: "field", expanded: false, level: 2, parentId: "doc:a" },
    ];
    await wrapper.vm.$nextTick();
    expect(vm.nodeMap.get("doc:a").type).toBe("document");
    expect(vm.nodeMap.get("field:a.x").parentId).toBe("doc:a");
  });

  it("recalculates when nodes changes", async () => {
    const wrapper = makeWrapper();
    const vm = wrapper.vm as any;
    const map1 = vm.nodeMap;
    vm.nodes = [{ id: "new:doc", type: "document", expanded: false, level: 0, parentId: undefined, label: "", displayValue: "", isEditable: false, loading: false }];
    await wrapper.vm.$nextTick();
    const map2 = vm.nodeMap;
    expect(map1).not.toBe(map2);
    expect(map2.get("new:doc")).toBeDefined();
  });
});

describe("FirestoreTreeView isNodeVisible", () => {
  it("returns true for level-0 nodes", () => {
    const wrapper = makeWrapper();
    const vm = wrapper.vm as any;
    const node = { id: "doc:a", parentId: undefined, level: 0, expanded: false, type: "document" };
    vm.nodes = [node];
    expect(vm.isNodeVisible(node)).toBe(true);
  });

  it("returns false when parent is collapsed", () => {
    const wrapper = makeWrapper();
    const vm = wrapper.vm as any;
    const parent = { id: "doc:a", parentId: undefined, level: 0, expanded: false, type: "document" };
    const child = { id: "field:a.x", parentId: "doc:a", level: 2, expanded: false, type: "field" };
    vm.nodes = [parent, child];
    expect(vm.isNodeVisible(child)).toBe(false);
  });

  it("returns true when all ancestors are expanded", () => {
    const wrapper = makeWrapper();
    const vm = wrapper.vm as any;
    const parent = { id: "doc:a", parentId: undefined, level: 0, expanded: true, type: "document" };
    const child = { id: "field:a.x", parentId: "doc:a", level: 2, expanded: false, type: "field" };
    vm.nodes = [parent, child];
    expect(vm.isNodeVisible(child)).toBe(true);
  });
});

describe("FirestoreTreeView insertNodesAfter", () => {
  it("inserts new nodes immediately after the parent node", () => {
    const wrapper = makeWrapper();
    const vm = wrapper.vm as any;
    const col = { id: "col:users", parentId: undefined, type: "collection", expanded: true, level: 0, label: "users", displayValue: "", isEditable: false, loading: false };
    const other = { id: "col:posts", parentId: undefined, type: "collection", expanded: false, level: 0, label: "posts", displayValue: "", isEditable: false, loading: false };
    vm.nodes = [col, other];

    const newDoc = { id: "doc:users/1", parentId: "col:users", type: "document", expanded: false, level: 1, label: "1", displayValue: "", isEditable: false, loading: false };
    vm.insertNodesAfter(col, [newDoc]);

    expect(vm.nodes[1].id).toBe("doc:users/1");
    expect(vm.nodes[2].id).toBe("col:posts");
  });
});

describe("FirestoreTreeView buildFromResults", () => {
  it("populates nodes with doc + field nodes in one assignment", async () => {
    const rows = [
      { __name__: "users/doc1", name: "Alice", age: 30 },
      { __name__: "users/doc2", name: "Bob", age: 25 },
    ];
    const fields = [
      { name: "__name__", dataType: "string" },
      { name: "name", dataType: "string" },
      { name: "age", dataType: "number" },
    ];
    const wrapper = makeWrapper({ rows, fields, tableName: "users" });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const vm = wrapper.vm as any;
    // 2 docs + 2 fields each = 6 nodes (__name__ is excluded)
    // Expected order: doc1, field:doc1.age, field:doc1.name, doc2, field:doc2.age, field:doc2.name
    expect(vm.nodes.length).toBe(6);
    expect(vm.nodes[0].type).toBe("document");
    expect(vm.nodes[1].type).toBe("field");
    expect(vm.nodes[2].type).toBe("field");
    expect(vm.nodes[3].type).toBe("document");
    expect(vm.nodes[4].type).toBe("field");
    expect(vm.nodes[5].type).toBe("field");
  });
});

describe("FirestoreTreeView loadDocuments", () => {
  it("inserts doc and field nodes after the collection node", async () => {
    const mockConn = {
      listTables: jest.fn().mockResolvedValue([
        { name: "users", entityType: "table" }
      ]),
      selectTop: jest.fn().mockResolvedValue({
        result: [{ __name__: "users/doc1", name: "Alice" }],
        pageState: null,
      }),
    };
    const wrapper = makeWrapper({ connection: mockConn, mode: "explorer" });
    const vm = wrapper.vm as any;

    // Build nodes from collections
    await vm.buildFromCollections();
    await wrapper.vm.$nextTick();

    // Now we should have the collection node
    expect(vm.nodes.length).toBe(1);
    expect(vm.nodes[0].type).toBe("collection");
    expect(vm.nodes[0].id).toBe("col:users");

    const colNode = vm.nodes[0];

    // Load documents into the collection
    await vm.loadDocuments(colNode);

    // col + 1 doc + 1 field = 3
    expect(vm.nodes.length).toBe(3);
    expect(vm.nodes[1].type).toBe("document");
    expect(vm.nodes[2].type).toBe("field");
  });
});

describe("FirestoreTreeView expandAll (results mode)", () => {
  it("expands all non-field nodes in one pass without async loading", async () => {
    const rows = [
      { __name__: "users/doc1", name: "Alice" },
      { __name__: "users/doc2", name: "Bob" },
    ];
    const fields = [
      { name: "__name__", dataType: "string" },
      { name: "name", dataType: "string" },
    ];
    const wrapper = makeWrapper({ rows, fields, mode: "results", tableName: "users" });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const vm = wrapper.vm as any;
    const forceUpdateSpy = jest.spyOn(vm, "$forceUpdate");

    await vm.expandAll();

    const docNodes = vm.nodes.filter((n: any) => n.type === "document");
    expect(docNodes.every((n: any) => n.expanded)).toBe(true);
    // Should call $forceUpdate exactly once
    expect(forceUpdateSpy).toHaveBeenCalledTimes(1);
  });
});
