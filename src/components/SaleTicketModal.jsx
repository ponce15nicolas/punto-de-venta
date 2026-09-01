// src/components/SaleTicketModal.jsx
// Ticket interno posterior a una venta: impresión térmica, PDF y compartir.

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import {
  buildTicketLines,
  downloadTicketPdf,
  printTicket,
  shareTicketPdf,
} from "../lib/saleTicket";

function normalizeWidth(value) {
  return Number(value) === 80 ? 80 : 58;
}

export default function SaleTicketModal({
  open,
  onClose,
  ticket,
  source = "sale",
}) {
  const [width, setWidth] = useState(() => normalizeWidth(ticket?.defaultWidth));
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");

  const lines = useMemo(
    () => (ticket ? buildTicketLines(ticket, width) : []),
    [ticket, width]
  );

  useEffect(() => {
    if (open) {
      setWidth(normalizeWidth(ticket?.defaultWidth));
      setSharing(false);
      setMessage("");
      return;
    }

    setSharing(false);
    setMessage("");
  }, [open, ticket]);

  function changeWidth(nextWidth) {
    setWidth(normalizeWidth(nextWidth));
  }

  function handlePrint() {
    if (!ticket) {
      return;
    }

    setMessage("");

    try {
      printTicket(ticket, width);
    } catch (error) {
      setMessage(error?.message || "No se pudo abrir la impresión.");
    }
  }

  function handleDownload() {
    if (!ticket) {
      return;
    }

    setMessage("");
    downloadTicketPdf(ticket, width);
    setMessage("PDF descargado. Ya podés adjuntarlo o guardarlo.");
  }

  async function handleShare() {
    if (!ticket || sharing) {
      return;
    }

    setSharing(true);
    setMessage("");

    try {
      const result = await shareTicketPdf(ticket, width);

      if (result?.shared) {
        setMessage("Ticket compartido.");
      } else if (result?.reason === "unsupported") {
        downloadTicketPdf(ticket, width);
        setMessage(
          "Este dispositivo no permite adjuntar el PDF desde el navegador. Lo descargué para que puedas enviarlo manualmente."
        );
      }
    } catch (error) {
      console.error("Error compartiendo ticket:", error);
      setMessage("No se pudo compartir el PDF. Podés descargarlo y enviarlo manualmente.");
    } finally {
      setSharing(false);
    }
  }

  const isHistory = source === "history";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isHistory ? "Ticket guardado" : "Ticket de venta"}
    >
      <div className="space-y-4">
        <section className="rounded-[22px] border border-[#FFC61A]/20 bg-[#FFC61A]/[0.06] p-3.5">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#FFC61A]">
            {isHistory ? "Reimpresión" : "Venta registrada"}
          </p>
          <h3 className="mt-1 text-base font-black text-white">
            {isHistory ? "Volvé a usar este ticket" : "¿Qué querés hacer con el ticket?"}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">
            {isHistory
              ? "Este comprobante interno quedó guardado con la venta. Podés reimprimirlo, descargarlo o compartirlo nuevamente."
              : "Es un comprobante interno no fiscal. Podés imprimirlo en papel térmico, descargarlo en PDF o compartirlo desde el dispositivo."}
          </p>
        </section>

        <section>
          <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.14em] text-white/40">
            Ancho del ticket
          </span>

          <div className="grid grid-cols-2 gap-2">
            {[58, 80].map((option) => {
              const active = width === option;

              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeWidth(option)}
                  className={
                    `rounded-2xl border px-3 py-3 text-sm font-black transition active:scale-[0.98] ` +
                    (active
                      ? "border-[#FFC61A] bg-[#FFC61A] text-black shadow-[0_10px_24px_rgba(255,198,26,0.14)]"
                      : "border-white/10 bg-white/[0.035] text-white/65 hover:border-white/20")
                  }
                >
                  {option} mm
                </button>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-[24px] bg-white text-[#111318] shadow-[0_14px_34px_rgba(0,0,0,0.16)]">
          <div className="flex items-center justify-between gap-3 border-b border-black/8 px-4 py-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#9A7100]">
                Vista previa
              </p>
              <p className="mt-0.5 text-xs font-bold text-black/45">
                {width} mm · ticket no fiscal
              </p>
            </div>
            <ReceiptIcon className="h-5 w-5 text-[#9A7100]" />
          </div>

          <pre className="max-h-[280px] overflow-y-auto whitespace-pre-wrap break-words px-4 py-4 font-mono text-[10px] font-semibold leading-[1.38] text-black/75">
            {lines.join("\n")}
          </pre>
        </section>

        {message && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-3 text-[11px] font-semibold leading-relaxed text-white/55">
            {message}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={handlePrint}
            disabled={!ticket}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-white/75 transition hover:border-white/20 hover:bg-white/[0.065] disabled:opacity-40"
          >
            <PrinterIcon className="h-[18px] w-[18px]" />
            Imprimir
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!ticket}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-white/75 transition hover:border-white/20 hover:bg-white/[0.065] disabled:opacity-40"
          >
            <DownloadIcon className="h-[18px] w-[18px]" />
            Descargar PDF
          </button>

          <button
            type="button"
            onClick={handleShare}
            disabled={!ticket || sharing}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#FFC61A] px-4 text-sm font-black text-black shadow-[0_12px_28px_rgba(255,198,26,0.14)] transition hover:bg-[#FFD248] active:scale-[0.99] disabled:opacity-45 sm:col-span-2"
          >
            <ShareIcon className="h-[18px] w-[18px]" />
            {sharing ? "Preparando PDF…" : "Compartir PDF"}
          </button>
        </div>

        <p className="text-center text-[10px] leading-relaxed text-white/30">
          En celulares compatibles, “Compartir PDF” abre el menú del sistema para enviarlo por WhatsApp, Mail u otra app.
        </p>
      </div>
    </Modal>
  );
}

function ReceiptIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </svg>
  );
}

function PrinterIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}

function DownloadIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function ShareIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4" />
      <path d="m8.6 13.5 6.8 4" />
    </svg>
  );
}
