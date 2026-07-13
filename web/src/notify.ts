// A minimal toast bus.
//
// It exists so that a failed WRITE surfaces something rather than nothing. The write handlers on the
// pages mostly fire-and-forget — `await api.deleteServer(id)` with no check on the result — so a 403
// for a non-admin used to be completely silent: the toggle sprang back, or the row stayed, and the
// user was left to guess whether they had misclicked or lacked permission.
//
// Catching it in one place (the api's `send`, which every mutation goes through) rather than at each
// of the seven call sites means every write is covered, and a new write route added later is covered
// automatically instead of being one more place to remember.

export interface Toast {
  id: number;
  kind: "error" | "info" | "success";
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

export function notify(t: Omit<Toast, "id">): void {
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
