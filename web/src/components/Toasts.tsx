import { useEffect, useState } from "react";
import { ToastNotification } from "@carbon/react";
import { dismiss, subscribeToasts, type Toast } from "../notify";

/**
 * Renders the toast bus (see notify.ts). Mounted once, in App, above the routes — so a permission
 * failure on any page surfaces the same way, in the same corner, regardless of which write triggered
 * it.
 */
export default function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  return (
    <div
      style={{ position: "fixed", top: "3.5rem", right: "1rem", zIndex: 9000, display: "grid", gap: "0.5rem" }}
    >
      {toasts.map((t) => (
        <ToastNotification
          key={t.id}
          kind={t.kind}
          title={t.title}
          subtitle={t.subtitle}
          onClose={() => {
            dismiss(t.id);
            return false; // we own the list; let notify.ts drive removal, not Carbon's internal state
          }}
          lowContrast
        />
      ))}
    </div>
  );
}
