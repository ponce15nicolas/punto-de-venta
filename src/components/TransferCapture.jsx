import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createWorker } from "tesseract.js";

/**
 * TransferCapture – Opens the rear camera, lets the user take a photo of a
 * transfer receipt, runs OCR via Tesseract.js (Spanish), and parses out:
 *   - Nombre completo
 *   - DNI / CUIL / CUIT
 *   - Fecha y hora
 *   - Monto
 *   - ID Coelsa (referencia)
 *
 * Props:
 *   open      – boolean, whether the capture overlay is visible
 *   onClose   – callback to close the overlay
 *   onResult  – callback({ name, dni, date, amount, coelsaId }) with parsed data
 *   total     – sale total (used as fallback for amount field)
 */
export default function TransferCapture({ open, onClose, onResult, total }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [phase, setPhase] = useState("camera"); // camera | processing | done | error
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);

  // Start camera when opened
  useEffect(() => {
    if (!open) return;
    setPhase("camera");
    setProgress(0);
    setPreview(null);

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open]);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setPreview(dataUrl);
    stopStream();
    setPhase("processing");

    try {
      const worker = await createWorker("spa", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      const { data } = await worker.recognize(dataUrl);
      await worker.terminate();

      const parsed = parseReceipt(data.text, total);
      setPhase("done");
      onResult(parsed);
    } catch {
      setPhase("error");
    }
  }

  function retry() {
    setPreview(null);
    setPhase("camera");
    setProgress(0);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => setPhase("error"));
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/80 z-[150] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-surface w-full max-w-[480px] rounded-2xl overflow-hidden"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <h3 className="font-display text-[15px] text-cream">📷 Escanear comprobante</h3>
            <button
              className="text-cream-dim text-lg"
              onClick={() => {
                stopStream();
                onClose();
              }}
            >
              ✕
            </button>
          </div>

          {/* Camera / Preview */}
          <div className="relative bg-black aspect-[4/3]">
            {phase === "camera" && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            )}
            {preview && (
              <img src={preview} alt="Comprobante" className="w-full h-full object-cover" />
            )}
            {phase === "camera" && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-6 border-2 border-dashed border-amber/50 rounded-xl" />
                <div className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-cream-dim font-mono">
                  Centrá el comprobante dentro del marco
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Status bar */}
          <div className="px-4 py-3">
            {phase === "camera" && (
              <button
                className="w-full bg-amber text-amber-ink rounded-lg py-3 font-semibold text-sm"
                onClick={capture}
              >
                📸 Capturar comprobante
              </button>
            )}

            {phase === "processing" && (
              <div className="text-center">
                <div className="text-cream-dim text-xs font-mono mb-2">
                  Procesando imagen… {progress}%
                </div>
                <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-amber rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            )}

            {phase === "done" && (
              <div className="text-center text-leaf font-semibold text-sm">
                ✓ Datos extraídos correctamente
              </div>
            )}

            {phase === "error" && (
              <div className="space-y-2">
                <div className="text-center text-brick text-sm">
                  No se pudo procesar la imagen
                </div>
                <button
                  className="w-full bg-surface-2 border border-line text-cream rounded-lg py-2.5 font-semibold text-sm"
                  onClick={retry}
                >
                  🔄 Reintentar
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Receipt parser ───────────────────────────────────────────────────────────

function parseReceipt(text, saleTotalFallback) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const full = lines.join(" ");

  return {
    name: extractName(lines, full),
    dni: extractDni(full),
    date: extractDate(full),
    amount: extractAmount(full, saleTotalFallback),
    coelsaId: extractCoelsaId(lines, full),
  };
}

function extractName(lines, full) {
  // Look for lines after "Nombre", "Titular", "Ordenante", "Beneficiario"
  const nameKeywords = /(?:nombre|titular|ordenante|beneficiario|de|para)\s*[:\-]?\s*/i;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(nameKeywords);
    if (match) {
      const after = lines[i].substring(match.index + match[0].length).trim();
      if (after.length > 3) return after;
      // Check next line
      if (i + 1 < lines.length && /^[A-ZÁÉÍÓÚÑ\s]{4,}$/.test(lines[i + 1].trim())) {
        return lines[i + 1].trim();
      }
    }
  }
  // Fallback: find a line that looks like a name (all uppercase, 2+ words)
  for (const line of lines) {
    if (/^[A-ZÁÉÍÓÚÑ]{2,}\s+[A-ZÁÉÍÓÚÑ]{2,}/.test(line.trim()) && line.trim().length < 50) {
      return line.trim();
    }
  }
  return "";
}

function extractDni(text) {
  // Match DNI/CUIL/CUIT patterns: XX-XXXXXXXX-X or just 7-8 digits near keyword
  const cuilMatch = text.match(/(?:CUIL|CUIT|C\.U\.I\.L|C\.U\.I\.T)[:\s]*(\d{2}[-.]?\d{7,8}[-.]?\d)/i);
  if (cuilMatch) return cuilMatch[1].replace(/[-.]/g, "");

  const dniMatch = text.match(/(?:DNI|D\.N\.I|Documento)[:\s]*(\d{7,8})/i);
  if (dniMatch) return dniMatch[1];

  // Standalone 7-8 digit number
  const standalone = text.match(/\b(\d{7,8})\b/);
  if (standalone) return standalone[1];

  return "";
}

function extractDate(text) {
  // DD/MM/YYYY HH:MM or DD-MM-YYYY HH:MM
  const full = text.match(/(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\s*[-–]?\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (full) return `${full[1]} ${full[2]}`;

  // Just date
  const dateOnly = text.match(/(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/);
  if (dateOnly) return dateOnly[1];

  return "";
}

function extractAmount(text, fallback) {
  // $1.234,56 or $1234.56 or $1234,56
  const moneyMatch = text.match(/\$\s*([\d.,]+)/);
  if (moneyMatch) {
    const raw = moneyMatch[1];
    // Argentine format: 1.234,56 → 1234.56
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(normalized);
    if (!isNaN(num) && num > 0) return num.toFixed(2);
  }

  // Number near "monto", "importe", "total"
  const amountMatch = text.match(/(?:monto|importe|total)[:\s]*\$?\s*([\d.,]+)/i);
  if (amountMatch) {
    const normalized = amountMatch[1].replace(/\./g, "").replace(",", ".");
    const num = parseFloat(normalized);
    if (!isNaN(num) && num > 0) return num.toFixed(2);
  }

  return fallback ? fallback.toFixed(2) : "";
}

function extractCoelsaId(lines, full) {
  // Look for Coelsa ID, reference number, or operation ID
  const coelsaMatch = full.match(/(?:coelsa|COELSA|id\s*coelsa)[:\s]*([A-Za-z0-9\-]+)/i);
  if (coelsaMatch) return coelsaMatch[1];

  const refMatch = full.match(/(?:referencia|ref|operaci[oó]n|nro\.?\s*op|comprobante|n[uú]mero)[:\s]*([A-Za-z0-9\-]+)/i);
  if (refMatch) return refMatch[1];

  // Look for a long alphanumeric string that could be a transaction ID
  const idMatch = full.match(/\b([A-Z0-9]{8,20})\b/);
  if (idMatch) return idMatch[1];

  return "";
}
