import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import Modal from "./Modal";

export default function Scanner({ open, onClose, onResult }) {
  const [status, setStatus] = useState("Iniciando cámara…");
  const [manual, setManual] = useState("");
  const scannerRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    startedRef.current = true;
    const el = document.getElementById("reader");
    if (!el) return;
    let cancelled = false;
    const instance = new Html5Qrcode("reader");
    scannerRef.current = instance;

    instance
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 140 } },
        (decodedText) => {
          if (cancelled) return;
          handleResult(decodedText);
        },
        () => {}
      )
      .then(() => {
        if (!cancelled) setStatus("Apuntá la cámara al código de barras");
      })
      .catch(() => {
        if (!cancelled) setStatus("No se pudo acceder a la cámara. Usá el campo manual.");
      });

    return () => {
      cancelled = true;
      if (scannerRef.current && startedRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current.clear())
          .catch(() => {});
      }
      startedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleResult(code) {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .then(() => scannerRef.current.clear())
        .catch(() => {});
    }
    onResult(code);
  }

  return (
    <Modal open={open} onClose={onClose} title="Escanear código">
      <div id="reader" className="w-full rounded-xl overflow-hidden bg-black min-h-[220px]" />
      <div className="text-center font-mono text-xs text-cream-dim mt-2.5">{status}</div>
      <div className="mt-3">
        <label className="block text-xs text-cream-dim mb-1.5">O escribilo manualmente</label>
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-cream font-mono text-sm"
            placeholder="Código de barras"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim()) handleResult(manual.trim());
            }}
          />
          <button
            className="bg-amber text-amber-ink rounded-lg px-4 font-semibold"
            onClick={() => manual.trim() && handleResult(manual.trim())}
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
