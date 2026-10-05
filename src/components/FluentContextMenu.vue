<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { FluentMenuItem } from "./fluentMenu";

const props = withDefaults(
  defineProps<{
    x: number;
    y: number;
    items: FluentMenuItem[];
  }>(),
  {},
);

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "close"): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const pos = ref({ left: props.x, top: props.y });

function updatePosition() {
  if (!menuRef.value) return;
  const rect = menuRef.value.getBoundingClientRect();
  const scale = Number(document.documentElement.style.getPropertyValue("--app-ui-zoom")) || 1;
  const margin = 8;
  const left = Math.min(props.x, window.innerWidth / scale - rect.width / scale - margin);
  const top = Math.min(props.y, window.innerHeight / scale - rect.height / scale - margin);
  pos.value = {
    left: Math.max(margin, left),
    top: Math.max(margin, top),
  };
}

function onSelect(item: FluentMenuItem) {
  if (item.separator || item.disabled || !item.id) return;
  emit("select", item.id);
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

function onOutsideMouseDown(event: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit("close");
  }
}

function onWindowEvent() {
  emit("close");
}

function onWindowScroll(event: Event) {
  // At high zoom the menu scrolls internally. Keep it open while users reach
  // lower items; scrolling the document still dismisses it.
  if (event.target instanceof Node && menuRef.value?.contains(event.target)) return;
  emit("close");
}

onMounted(() => {
  void nextTick(updatePosition);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("mousedown", onOutsideMouseDown, true);
  window.addEventListener("resize", onWindowEvent);
  window.addEventListener("scroll", onWindowScroll, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("mousedown", onOutsideMouseDown, true);
  window.removeEventListener("resize", onWindowEvent);
  window.removeEventListener("scroll", onWindowScroll, true);
});

watch(
  () => [props.x, props.y, props.items],
  () => {
    void nextTick(updatePosition);
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="fluent-menu ui-controls"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, maxHeight: 'calc(var(--app-viewport-height, 100vh) - 16px)', overflowY: 'auto' }"
      @contextmenu.prevent
      @mousedown.stop
    >
      <template v-for="(item, index) in items" :key="item.id ?? index">
        <div v-if="item.separator" class="fluent-menu-separator" />
        <button
          v-else
          type="button"
          class="fluent-menu-item"
          :class="{ disabled: item.disabled, danger: item.danger, checked: item.checked }"
          :disabled="item.disabled"
          @click="onSelect(item)"
        >
          <span class="fluent-menu-check" aria-hidden="true">{{ item.checked ? "✓" : "" }}</span>
          <span v-if="item.icon" class="fluent-menu-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="fluent-menu-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="fluent-menu-shortcut">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
