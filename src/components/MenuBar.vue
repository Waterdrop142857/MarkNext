<script setup lang="ts">
import { t } from "../i18n";
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
  <nav class="menu-bar ui-controls" @selectstart.prevent>
    <div
      v-for="menu in menus"
      :key="menu.id"
      class="menu-item"
      @click.stop="menu.command ? $emit('command', menu.command) : $emit('toggle', menu.id)"
    >
      <button
        type="button"
        class="menu-trigger"
        :aria-haspopup="menu.command ? 'dialog' : undefined"
        :class="{ active: openMenuId === menu.id }"
      >
        {{ menu.label }}
      </button>
      <div v-if="!menu.command && openMenuId === menu.id" class="menu-dropdown">
        <button
          v-for="item in menu.items"
          :key="item.id"
          type="button"
          class="menu-command"
          :class="{ active: item.checked }"
          :disabled="item.disabled"
          @click.stop="$emit('command', item.id)"
        >
          <span class="menu-command-label">
            {{
              item.id === "toggleMode"
                ? isSourceMode
                  ? t("command.wysiwyg")
                  : t("command.toggleMode")
                : item.label
            }}
          </span>
          <span v-if="item.shortcut" class="menu-command-shortcut">{{ item.shortcut }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>
