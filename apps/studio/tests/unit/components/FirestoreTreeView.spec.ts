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
});
