import { FieldErrors } from "react-hook-form";

/**
 * Why: submit時に最初のエラーへスクロールさせることで入力体験を改善する。
 */
export function scrollToFirstError(errors: FieldErrors) {
  const firstKey = Object.keys(errors)[0];
  if (!firstKey || typeof document === "undefined") return;
  const target = document.querySelector(`[data-error-for="${firstKey}"]`) as HTMLElement | null;
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  target?.focus();
}
