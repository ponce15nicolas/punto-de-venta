// src/components/Scanner.jsx
// Escáner de códigos de barras rediseñado con la identidad visual del POS.
// Mantiene html5-qrcode, ingreso manual y el componente Modal.
// Agrega una interfaz de cámara más clara y evita resultados duplicados.

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Html5Qrcode,
  Html5QrcodeScannerState,
} from "html5-qrcode";
import Modal from "./Modal";

export default function Scanner({
  open,
  onClose,
  onResult,
}) {
  const [status, setStatus] = useState(
    "Iniciando cámara…"
  );

  const [manual, setManual] =
    useState("");

  const scannerRef =
    useRef(null);

  const stoppingRef =
    useRef(false);

  const resultHandledRef =
    useRef(false);

  /* =========================================================
     DETENER SCANNER
  ========================================================= */

  const stopScanner = async () => {
    const scanner =
      scannerRef.current;

    if (
      !scanner ||
      stoppingRef.current
    ) {
      return;
    }

    stoppingRef.current = true;

    try {
      const state =
        scanner.getState();

      if (
        state ===
        Html5QrcodeScannerState.SCANNING ||
        state ===
        Html5QrcodeScannerState.PAUSED
      ) {
        await scanner.stop();
      }
    } catch {
      // Ignoramos errores al detener la cámara.
    }

    try {
      await scanner.clear();
    } catch {
      // Ignoramos errores al limpiar el scanner.
    }

    scannerRef.current = null;
  };

  /* =========================================================
     INICIAR CÁMARA
  ========================================================= */

  useEffect(() => {
    if (!open) return;

    setStatus(
      "Iniciando cámara…"
    );

    setManual("");

    resultHandledRef.current =
      false;

    stoppingRef.current =
      false;

    const element =
      document.getElementById(
        "reader"
      );

    if (!element) {
      return;
    }

    let cancelled = false;

    const instance =
      new Html5Qrcode(
        "reader"
      );

    scannerRef.current =
      instance;

    instance
      .start(
        {
          facingMode:
            "environment",
        },
        {
          fps: 10,
          qrbox: {
            width: 250,
            height: 140,
          },
        },
        (decodedText) => {
          if (
            cancelled ||
            resultHandledRef.current
          ) {
            return;
          }

          handleResult(
            decodedText
          );
        },
        () => {
          // Los errores de lectura cuadro a cuadro son normales.
        }
      )
      .then(() => {
        if (!cancelled) {
          setStatus(
            "Apuntá la cámara al código de barras"
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(
            "No se pudo acceder a la cámara. Podés ingresar el código manualmente."
          );
        }
      });

    return () => {
      cancelled = true;
      stopScanner();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* =========================================================
     RESULTADO
  ========================================================= */

  function handleResult(
    value
  ) {
    const code =
      String(value || "").trim();

    if (
      !code ||
      resultHandledRef.current
    ) {
      return;
    }

    resultHandledRef.current =
      true;

    stopScanner();

    onResult(code);
  }

  function submitManual() {
    const code =
      manual.trim();

    if (!code) return;

    handleResult(code);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Escanear código"
    >
      <div>
        {/* =================================================
            CÁMARA
        ================================================= */}

        <div
          className="
            relative
            overflow-hidden
            rounded-[24px]
            border
            border-white/10
            bg-black
            shadow-[0_16px_40px_rgba(0,0,0,0.28)]
          "
        >
          <div
            id="reader"
            className="
              min-h-[240px]
              w-full
              bg-black
              [&_canvas]:rounded-[22px]
              [&_video]:min-h-[240px]
              [&_video]:w-full
              [&_video]:rounded-[22px]
              [&_video]:object-cover
            "
          />

          {/* Overlay visual */}

          <div
            className="
              pointer-events-none
              absolute
              inset-0
              flex
              items-center
              justify-center
            "
            aria-hidden="true"
          >
            <div
              className="
                relative
                h-[140px]
                w-[250px]
                max-w-[78%]
                rounded-[20px]
              "
            >
              <ScanCorner position="top-left" />
              <ScanCorner position="top-right" />
              <ScanCorner position="bottom-left" />
              <ScanCorner position="bottom-right" />

              <motion.div
                animate={{
                  y: [
                    8,
                    116,
                    8,
                  ],
                }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="
                  absolute
                  left-3
                  right-3
                  top-0
                  h-[2px]
                  rounded-full
                  bg-[#FFC61A]
                  shadow-[0_0_14px_rgba(255,198,26,0.75)]
                "
              />
            </div>
          </div>

          {/* Badge cámara */}

          <div
            className="
              pointer-events-none
              absolute
              left-3
              top-3
              inline-flex
              items-center
              gap-1.5
              rounded-full
              border
              border-white/10
              bg-black/55
              px-2.5
              py-1.5
              text-[9px]
              font-extrabold
              uppercase
              tracking-[0.12em]
              text-white/70
              backdrop-blur-md
            "
          >
            <CameraIcon className="h-3.5 w-3.5 text-[#FFC61A]" />
            Cámara
          </div>
        </div>

        {/* =================================================
            ESTADO
        ================================================= */}

        <div
          className="
            mt-3
            flex
            items-start
            gap-2.5
            rounded-2xl
            border
            border-white/10
            bg-[#151A22]
            px-3.5
            py-3
          "
        >
          <div
            className="
              mt-0.5
              grid
              h-8
              w-8
              shrink-0
              place-items-center
              rounded-xl
              bg-[#FFC61A]/10
              text-[#FFC61A]
            "
          >
            <ScanIcon className="h-4 w-4" />
          </div>

          <div>
            <span
              className="
                block
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.12em]
                text-white/30
              "
            >
              Escáner
            </span>

            <p
              className="
                mt-0.5
                text-xs
                font-semibold
                leading-relaxed
                text-white/55
              "
            >
              {status}
            </p>
          </div>
        </div>

        {/* =================================================
            SEPARADOR
        ================================================= */}

        <div
          className="
            my-4
            flex
            items-center
            gap-3
          "
        >
          <div className="h-px flex-1 bg-white/10" />

          <span
            className="
              text-[9px]
              font-extrabold
              uppercase
              tracking-[0.14em]
              text-white/25
            "
          >
            o ingresalo manualmente
          </span>

          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* =================================================
            CÓDIGO MANUAL
        ================================================= */}

        <label
          htmlFor="manual-barcode"
          className="
            mb-1.5
            block
            text-xs
            font-bold
            text-white/55
          "
        >
          Código de barras
        </label>

        <div className="flex gap-2.5">
          <div
            className="
              relative
              min-w-0
              flex-1
            "
          >
            <BarcodeIcon
              className="
                pointer-events-none
                absolute
                left-3.5
                top-1/2
                h-4
                w-4
                -translate-y-1/2
                text-white/30
              "
            />

            <input
              id="manual-barcode"
              data-modal-autofocus="true"
              inputMode="numeric"
              autoComplete="off"
              className="
                w-full
                rounded-2xl
                border
                border-white/10
                bg-[#171B23]
                py-3.5
                pl-10
                pr-3.5
                text-sm
                font-extrabold
                text-white
                outline-none
                transition
                placeholder:text-white/25
                focus:border-[#FFC61A]
                focus:ring-2
                focus:ring-[#FFC61A]/10
              "
              placeholder="Ej: 7791234567890"
              value={manual}
              onChange={(e) =>
                setManual(
                  e.target.value
                )
              }
              onKeyDown={(e) => {
                if (
                  e.key ===
                  "Enter"
                ) {
                  submitManual();
                }
              }}
            />
          </div>

          <button
            type="button"
            data-modal-primary="true"
            disabled={!manual.trim()}
            onClick={submitManual}
            className="
              inline-flex
              shrink-0
              items-center
              justify-center
              gap-1.5
              rounded-2xl
              bg-[#FFC61A]
              px-4
              py-3.5
              text-sm
              font-extrabold
              text-black
              shadow-[0_10px_26px_rgba(255,198,26,0.16)]
              transition
              hover:bg-[#FFD248]
              active:scale-[0.97]
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
          >
            <CheckIcon className="h-4 w-4" />
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================
   ESQUINAS DEL ÁREA DE ESCANEO
========================================================= */

function ScanCorner({
  position,
}) {
  const positionClass = {
    "top-left":
      "left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-xl",

    "top-right":
      "right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-xl",

    "bottom-left":
      "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-xl",

    "bottom-right":
      "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-xl",
  };

  return (
    <span
      className={`
        absolute
        h-7
        w-7
        border-[#FFC61A]
        ${positionClass[position]}
      `}
    />
  );
}

/* =========================================================
   ICONOS INLINE
========================================================= */

function CameraIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z" />
      <circle
        cx="12"
        cy="13"
        r="3"
      />
    </svg>
  );
}

function ScanIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M7 12h10" />
    </svg>
  );
}

function BarcodeIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 5v14" />
      <path d="M7 5v14" />
      <path d="M10 5v14" />
      <path d="M14 5v14" />
      <path d="M17 5v14" />
      <path d="M21 5v14" />
    </svg>
  );
}

function CheckIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5 9.2 17 19 7" />
    </svg>
  );
}
