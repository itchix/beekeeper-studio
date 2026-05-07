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
