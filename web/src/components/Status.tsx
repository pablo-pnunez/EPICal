import { Loader, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <p className="status status--loading" role="status">
      <Loader size={16} className="spin" aria-hidden /> {label}
    </p>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="status status--error" role="alert">
      <TriangleAlert size={18} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
