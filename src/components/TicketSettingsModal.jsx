import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "../firebase/config";
import Modal from "./Modal";
import { buildTicketLines } from "../lib/saleTicket";

const guardarConfiguracionTicket = httpsCallable(
  functions,
  "guardarConfiguracionTicket"
);

function normalizeConfig(config) {
  const source = config && typeof config === "object" ? config : {};

  return {
    businessName: String(source.businessName || ""),
    address: String(source.address || ""),
    phone: String(source.phone || ""),
    footerText: String(source.footerText || ""),
    defaultWidth: Number(source.defaultWidth) === 80 ? 80 : 58,
    autoOpen: source.autoOpen !== false,
  };
}

export default function TicketSettingsModal({
  open,
  onClose,
  ticketConfig,
  shopName,
  clienteId,
  deviceId,
  sessionId,
  operadorSesion,
  operatorName = "",
}) {
  const [form, setForm] = useState(() => normalizeConfig(ticketConfig));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("success");

  useEffect(() => {
    if (open) {
      setForm(normalizeConfig(ticketConfig));
      setMessage("");
      setSaving(false);
    }
  }, [open, ticketConfig]);

  const previewTicket = useMemo(
    () => ({
      sale: {
        id: "preview-ticket-6631008",
        timestamp: Date.now(),
        total: 10300,
        items: [
          {
            name: "Fernet Branca 750 cc",
            qty: 1,
            price: 8000,
            subtotal: 8000,
            tipoVenta: "unidad",
          },
          {
            name: "Coca Cola 2,25 L",
            qty: 1,
            price: 2300,
            subtotal: 2300,
            tipoVenta: "unidad",
          },
        ],
        payment: {
          method: "efectivo",
          received: 11000,
          change: 700,
        },
      },
      shopName: form.businessName.trim() || shopName || "Mi Negocio",
      address: form.address,
      phone: form.phone,
      footerText: form.footerText,
      operatorName: operatorName || "Operador",
      defaultWidth: form.defaultWidth,
    }),
    [form, shopName, operatorName]
  );

  const previewLines = useMemo(
    () => buildTicketLines(previewTicket, form.defaultWidth),
    [previewTicket, form.defaultWidth]
  );

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    if (!message) return undefined;

    const timer = window.setTimeout(() => {
      setMessage("");
    }, messageTone === "success" ? 3200 : 5200);

    return () => window.clearTimeout(timer);
  }, [message, messageTone]);

  async function handleSave() {
    if (saving) return;

    setSaving(true);
    setMessage("");

    try {
      await guardarConfiguracionTicket({
        clienteId,
        deviceId,
        sessionId,
        operadorSesion,
        businessName: form.businessName.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        footerText: form.footerText.trim(),
        defaultWidth: form.defaultWidth,
        autoOpen: form.autoOpen,
      });

      setMessageTone("success");
      setMessage("Configuración guardada correctamente.");
    } catch (error) {
      console.error("Error guardando configuración de ticket:", error);
      setMessageTone("error");
      setMessage(
        error?.message || "No se pudo guardar la configuración del ticket."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Configuración de ticket">
      <div className="space-y-4">
        <section className="rounded-[22px] border border-[#FFC61A]/20 bg-[#FFC61A]/[0.06] p-3.5">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#FFC61A]">
            Ticket no fiscal
          </p>
          <h3 className="mt-1 text-base font-black text-white">
            Personalizá el comprobante del negocio
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">
            Estos datos se usan al imprimir, descargar o compartir tickets. La
            habilitación general del módulo sigue dependiendo de tu proveedor.
          </p>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre comercial" className="sm:col-span-2">
            <input
              value={form.businessName}
              onChange={(event) => update("businessName", event.target.value)}
              maxLength={120}
              placeholder={shopName || "Mi Negocio"}
              className="w-full rounded-2xl border border-white/10 bg-[#171B23] px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-[#FFC61A]"
            />
          </Field>

          <Field label="Dirección">
            <input
              value={form.address}
              onChange={(event) => update("address", event.target.value)}
              maxLength={180}
              placeholder="Ej. Av. Principal 123 · Ciudad"
              className="w-full rounded-2xl border border-white/10 bg-[#171B23] px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-[#FFC61A]"
            />
          </Field>

          <Field label="Teléfono">
            <input
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              maxLength={60}
              inputMode="tel"
              placeholder="Ej. 11 1234 5678"
              className="w-full rounded-2xl border border-white/10 bg-[#171B23] px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-[#FFC61A]"
            />
          </Field>

          <Field label="Texto al pie" className="sm:col-span-2">
            <textarea
              value={form.footerText}
              onChange={(event) => update("footerText", event.target.value)}
              maxLength={240}
              rows={3}
              placeholder="Ej. Gracias por elegirnos · Te esperamos nuevamente"
              className="w-full resize-none rounded-2xl border border-white/10 bg-[#171B23] px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-[#FFC61A]"
            />
          </Field>
        </div>

        <section>
          <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">
            Ancho predeterminado
          </span>
          <div className="grid grid-cols-2 gap-2">
            {[58, 80].map((width) => {
              const active = form.defaultWidth === width;
              return (
                <button
                  key={width}
                  type="button"
                  onClick={() => update("defaultWidth", width)}
                  className={
                    `rounded-2xl border px-3 py-3 text-sm font-black transition ` +
                    (active
                      ? "border-[#FFC61A] bg-[#FFC61A] text-black"
                      : "border-white/10 bg-white/[0.035] text-white/65 hover:border-white/20")
                  }
                >
                  {width} mm
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          role="switch"
          aria-checked={form.autoOpen}
          onClick={() => update("autoOpen", !form.autoOpen)}
          className="flex w-full items-center justify-between gap-4 rounded-[20px] border border-white/10 bg-white/[0.035] px-4 py-3.5 text-left"
        >
          <span>
            <strong className="block text-sm font-black text-white">
              Abrir ticket al finalizar venta
            </strong>
            <span className="mt-1 block text-[11px] text-white/40">
              Si lo desactivás, el último ticket seguirá disponible desde Vender.
            </span>
          </span>
          <span
            className={
              `relative h-7 w-12 shrink-0 rounded-full transition ` +
              (form.autoOpen ? "bg-[#FFC61A]" : "bg-white/10")
            }
          >
            <span
              className={
                `absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ` +
                (form.autoOpen ? "left-6" : "left-1")
              }
            />
          </span>
        </button>

        <section className="overflow-hidden rounded-[24px] bg-white text-[#111318] shadow-[0_14px_34px_rgba(0,0,0,0.16)]">
          <div className="border-b border-black/10 px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#9A7100]">
              Vista previa
            </p>
            <p className="mt-0.5 text-xs font-bold text-black/45">
              {form.defaultWidth} mm · así se verá el contenido
            </p>
          </div>
          <pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap px-4 py-4 font-mono text-[10px] font-semibold leading-[1.38] text-black/75">
            {previewLines.join("\n")}
          </pre>
        </section>

        {message && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.35)]"
            style={{
              background: messageTone === "success" ? "#157347" : "#B42318",
              border: `1px solid ${messageTone === "success" ? "#2FB171" : "#E34A3B"}`,
              color: "#FFFFFF",
            }}
          >
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15 text-sm font-black"
              >
                {messageTone === "success" ? "✓" : "!"}
              </span>
              <span className="text-[12px] font-extrabold leading-snug">
                {message}
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="min-h-12 w-full rounded-2xl bg-[#FFC61A] px-4 text-sm font-black text-black shadow-[0_12px_28px_rgba(255,198,26,0.14)] transition hover:bg-[#FFD248] active:scale-[0.99] disabled:opacity-45"
        >
          {saving ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, className = "", children }) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-white/45">
        {label}
      </span>
      {children}
    </label>
  );
}
