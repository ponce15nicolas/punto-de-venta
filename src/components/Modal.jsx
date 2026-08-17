// src/components/Modal.jsx

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

export default function Modal({
  open,
  onClose,
  title,
  children,
}) {
  /* =========================================================
     BLOQUEAR SCROLL DEL FONDO
  ========================================================= */

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [open]);

  /* =========================================================
     CERRAR CON ESC
  ========================================================= */

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [open, onClose]);

  /* =========================================================
     PORTAL
  ========================================================= */

  if (
    typeof document === "undefined"
  ) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="
            fixed
            inset-0
            z-[9999]
            flex
            items-end
            justify-center
            overflow-hidden
            bg-black/75
            backdrop-blur-[3px]
            sm:items-center
            sm:p-4
          "
          initial={{
            opacity: 0,
          }}
          animate={{
            opacity: 1,
          }}
          exit={{
            opacity: 0,
          }}
          transition={{
            duration: 0.18,
          }}
          onClick={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              onClose();
            }
          }}
        >
          <motion.div
            className="
              relative
              flex
              max-h-[calc(100dvh-12px)]
              w-full
              max-w-[520px]
              flex-col
              overflow-hidden
              rounded-t-[30px]
              border
              border-white/10
              bg-gradient-to-b
              from-[#11151C]
              to-[#0D1016]
              shadow-[0_-20px_70px_rgba(0,0,0,0.48)]

              sm:max-h-[calc(100dvh-32px)]
              sm:rounded-[30px]
            "
            initial={{
              y: "100%",
              opacity: 0.98,
            }}
            animate={{
              y: 0,
              opacity: 1,
            }}
            exit={{
              y: "100%",
              opacity: 0.98,
            }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 38,
            }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            {/* ===============================================
                TIRADOR MOBILE
            =============================================== */}

            <div
              className="
                flex
                shrink-0
                justify-center
                pb-1
                pt-2.5
                sm:hidden
              "
              aria-hidden="true"
            >
              <div
                className="
                  h-1
                  w-10
                  rounded-full
                  bg-white/15
                "
              />
            </div>

            {/* ===============================================
                HEADER
            =============================================== */}

            <div
              className="
                relative
                shrink-0
                border-b
                border-white/10
                px-4
                pb-3.5
                pt-3
                sm:px-5
                sm:pb-4
                sm:pt-4
              "
            >
              <div className="pr-12">
                <span
                  className="
                    block
                    text-[9px]
                    font-extrabold
                    uppercase
                    tracking-[0.18em]
                    text-[#FFC61A]
                  "
                >
                  Mi Negocio
                </span>

                <h2
                  className="
                    mt-1
                    text-lg
                    font-black
                    tracking-[-0.02em]
                    text-white
                    sm:text-xl
                  "
                >
                  {title}
                </h2>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="
                  absolute
                  right-3.5
                  top-1/2
                  grid
                  h-9
                  w-9
                  -translate-y-1/2
                  place-items-center
                  rounded-xl
                  border
                  border-white/10
                  bg-white/5
                  text-white/55
                  transition
                  hover:border-white/20
                  hover:bg-white/10
                  hover:text-white
                  active:scale-[0.96]
                "
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            {/* ===============================================
                CONTENIDO SCROLLEABLE
            =============================================== */}

            <div
              className="
                min-h-0
                flex-1
                overflow-y-auto
                overscroll-contain
                px-4
                pb-[calc(28px+env(safe-area-inset-bottom))]
                pt-4
                [-webkit-overflow-scrolling:touch]
                sm:px-5
                sm:pb-5
                sm:pt-5
              "
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/* =========================================================
   ICONO
========================================================= */

function CloseIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}