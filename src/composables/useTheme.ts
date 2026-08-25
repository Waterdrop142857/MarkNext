import { computed, onBeforeUnmount, ref, watch } from "vue";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "marknext-theme-mode";

function getInitialThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  }
  catch {
    // localStorage unavailable (private mode / tests)
  }

  return "light";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const themeMode = ref<ThemeMode>(getInitialThemeMode());
  const systemDark = ref(systemPrefersDark());
  let mediaQuery: MediaQueryList | null = null;

  const isDark = computed(() => {
    if (themeMode.value === "dark") return true;
    if (themeMode.value === "system") return systemDark.value;
    return false;
  });

  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode;
  }

  function toggleTheme() {
    // Quick toggle: explicitly switch to the opposite of the current effective
    // theme. "system" resolves to the system value first, then flips to the
    // opposite explicit theme.
    setThemeMode(isDark.value ? "light" : "dark");
  }

  function onSystemThemeChange(event: MediaQueryListEvent) {
    systemDark.value = event.matches;
  }

  watch(
    themeMode,
    (mode) => {
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      }
      catch {
        // Ignore storage errors.
      }
    },
    { immediate: true },
  );

  watch(
    isDark,
    (dark) => {
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    },
    { immediate: true },
  );

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", onSystemThemeChange);
  }

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener("change", onSystemThemeChange);
  });

  return { themeMode, isDark, setThemeMode, toggleTheme };
}