// A minimal toast bus, so a failed WRITE surfaces something. Page handlers mostly fire-and-forget, so
// a 403 for a non-admin used to be silent (the toggle sprang back, the user left to guess). Catching
// it in one place — the api's `send`, which every mutation goes through — covers every write,
// including ones added later.

export interface Toast {
  id: number;
  kind: 'error' | 'info' | 'success';
  title: string;
  subtitle?: string;
}

let seq = 0;
const listeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];

function emit(): void {
  listeners.forEach((l) => l(toasts));
}

export function subscribeToasts(fn: (toasts: Toast[]) => void): () => void {
  listeners.add(fn);
  fn(toasts);
  return () => listeners.delete(fn);
}

export function notify(t: Omit<Toast, 'id'>): void {
  const toast = { ...t, id: ++seq };
  toasts = [...toasts, toast];
  emit();
  // Auto-dismiss. A permission toast is a nudge, not a modal — it should not need clearing by hand.
  window.setTimeout(() => dismiss(toast.id), 6_000);
}

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
