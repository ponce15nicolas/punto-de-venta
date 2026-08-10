export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function money(v) {
  return "$" + (Number(v) || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
  );
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function daysUntil(iso) {
  if (!iso) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}
