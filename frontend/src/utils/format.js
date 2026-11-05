/**
 * Botswana Pula formatting. Using Intl.NumberFormat with explicit "BWP"
 * rather than a hardcoded "P" prefix + toFixed(2) — handles thousands
 * separators and rounding correctly, and is trivial to internationalize
 * later if the product expands beyond Botswana.
 */
const moneyFormatter = new Intl.NumberFormat("en-BW", {
  style: "currency",
  currency: "BWP",
  currencyDisplay: "narrowSymbol",
});

export function formatMoney(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return moneyFormatter.format(n);
}

const dateFormatter = new Intl.DateTimeFormat("en-BW", { day: "numeric", month: "short", year: "numeric" });

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormatter.format(d);
}
