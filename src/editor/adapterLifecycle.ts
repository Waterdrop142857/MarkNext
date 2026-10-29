import type { DocumentRevision, RendererLease } from "./sessionTypes";

export interface AdapterContext {
  readonly lease: RendererLease;
  readonly scrollHost?: HTMLElement;
  identity(): DocumentRevision;
  isCurrent(): boolean;
  silently(action: () => void): void;
  cleanup(): void;
}

export function adapterLifecycle(root: HTMLElement, initial: AdapterContext) {
  let node: HTMLElement | null = root;
  let context: AdapterContext | null = initial;
  let composing = false;
  let settling = false;
  const start = () => { composing = true; };
  const end = () => {
    composing = false; settling = true;
    queueMicrotask(() => { settling = false; });
  };
  root.addEventListener("compositionstart", start, true);
  root.addEventListener("compositionend", end, true);
  return {
    lease: { ...initial.lease },
    live: () => !!context?.isCurrent(),
    blocked: () => composing || settling,
    identity: () => context?.identity(),
    silently: (action: () => void) => context?.silently(action),
    dispose() {
      if (!context) return;
      const previous = context;
      context = null; // Invalidate callbacks before destroying editor resources.
      node?.removeEventListener("compositionstart", start, true);
      node?.removeEventListener("compositionend", end, true);
      node = null;
      previous.cleanup();
    },
  };
}
