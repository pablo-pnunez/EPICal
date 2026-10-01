import { Languages } from "lucide-react";

/** Marca de docencia en inglés (icono outline, sin emojis). */
export function EnglishMark({ title = "Docencia en inglés" }: { title?: string }) {
  return (
    <span className="english-mark" title={title} aria-label={title}>
      <Languages size={13} aria-hidden />
      EN
    </span>
  );
}
