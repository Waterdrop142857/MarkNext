<script setup lang="ts">
import type { AppMenu } from "../config/menus";

withDefaults(
  defineProps<{
    menus: AppMenu[];
    openMenuId: string | null;
    isSourceMode: boolean;
  }>(),
  {
    openMenuId: null,
    isSourceMode: false,
  },
);

defineEmits<{
  (e: "toggle", menuId: string): void;
  (e: "command", itemId: string): void;
}>();
</script>

<template>
  <nav class="menu-bar" @selectstart.prevent>
    <div
      v-for="menu in menus"
      :key="menu.id"
      class="menu-item"
      @click.stop="$emit('toggle', menu.id)"
    >
      <button
        type="button"
        class="menu-trigger"
        :class="{ active: openMenuId === menu.id }"
      >
        {{ menu.label }}
      </button>
      <div v-if="openMenuId === menu.id" class="menu-dropdown">
        <button
          v-for="item in menu.items"
          :key="item.id"
          type="button"
          class="menu-command"
          :class="{ active: item.checked }"
          :disabled="item.disabled"
          @click.stop="$emit('command', item.id)"
        >
          {{
            item.id === "toggleMode"
              ? isSourceMode
                ? "所见即所得"
                : "源码模式"
              : item.label
          }}
        </button>
      </div>
    </div>
  </nav>
</template>