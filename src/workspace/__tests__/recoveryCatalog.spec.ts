import { ref } from "vue";
import { expect, it, vi } from "vitest";
import type { RecoveryListing, RecoverySnapshot } from "../../document/types";
import type { RecoveryStore } from "../../document/ports";
import { useRecoveryCatalog } from "../useRecoveryCatalog";

function snapshot(id: string): RecoverySnapshot {
  return { version: 1, id, path: null, content: id, savedContent: "", encoding: "utf-8", bom: false,
    diskVersion: "missing", sourceMode: false, updatedAt: 1 };
}

it("does not advertise records retired or opened while a listing is pending", async () => {
  let finish!: (listing: RecoveryListing) => void;
  const store: RecoveryStore = { list: () => new Promise(resolve => { finish = resolve; }),
    write: async () => {}, remove: vi.fn().mockResolvedValue(undefined) };
  const open = ref<string[]>([]);
  const catalog = useRecoveryCatalog(store, () => open.value, () => false);
  const starting = catalog.start();
  open.value = ["open"];
  catalog.retire("retired");
  finish({ records: [snapshot("open"), snapshot("retired"), snapshot("remaining")], unreadable: 2 });
  await starting;
  expect(catalog.ready.value).toBe(false);
  catalog.markReady();
  expect(catalog.ready.value).toBe(true);
  expect(catalog.records.value.map(record => record.id)).toEqual(["remaining"]);
  expect(catalog.unreadable.value).toBe(2);
  expect(await catalog.remove("open")).toBe(false);
  expect(store.remove).not.toHaveBeenCalled();
  expect(await catalog.remove("remaining")).toBe(true);
  expect(catalog.records.value).toEqual([]);
});


it("rechecks whether a record was opened while its removal waited in the queue", async () => {
  let finish!: () => void;
  const remove = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const store: RecoveryStore = { list: async () => ({ records: [], unreadable: 0 }), write: async () => {}, remove };
  const open = ref<string[]>([]);
  const catalog = useRecoveryCatalog(store, () => open.value, () => false);
  const first = catalog.remove("first");
  await Promise.resolve();
  const second = catalog.remove("second");
  open.value = ["second"];
  finish();
  expect(await first).toBe(true);
  expect(await second).toBe(false);
  expect(remove).toHaveBeenCalledTimes(1);
});
