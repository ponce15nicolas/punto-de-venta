// src/components/Toast.jsx
// Toast rediseñado con la misma identidad visual del POS.
// Mantiene AnimatePresence, motion/react y el cierre automático.

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

export default function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => {
      onDone();
    }, 2200);

    return () => clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.key}
          initial={{
            opacity: 0,
            y: 16,
            x: "-50%",
            scale: 0.96,
          }}
          animate={{
            opacity: 1,
            y: 0,
            x: "-50%",
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: 12,
            x: "-50%",
            scale: 0.97,
          }}
          transition={{
            type: "spring",
            stiffness: 420,
            damping: 30,
          }}
          role={toast.error ? "alert" : "status"}
          aria-live="polite"
          className={
            `
              fixed
              bottom-[96px]
              left-1/2
              z-[200]
              flex
              max-w-[calc(100vw-32px)]
              items-center
              gap-2.5
              rounded-2xl
              border
              px-4
              py-3
              text-[13px]
              font-extrabold
              shadow-[0_18px_45px_rgba(0,0,0,0.35)]
              backdrop-blur-xl
              sm:bottom-[102px]
            ` +
            (toast.error
              ? `
                border-red-400/25
                bg-[#241316]/95
                text-red-200
              `
              : `
                border-[#FFC61A]/25
                bg-[#171B23]/95
                text-white
              `)
          }
        >
          <div
            className={
              `
                grid
                h-8
                w-8
                shrink-0
                place-items-center
                rounded-xl
              ` +
              (toast.error
                ? `
                  bg-red-500/15
                  text-red-400
                `
                : `
                  bg-[#FFC61A]
                  text-black
                `)
            }
          >
            {toast.error ? (
              <ErrorIcon className="h-4 w-4" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}
          </div>

          <span className="min-w-0 leading-snug">
            {toast.text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* =========================================================
   ICONOS INLINE
========================================================= */

function CheckIcon({ className = "" }) {
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

function ErrorIcon({ className = "" }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6" />
      <path d="M15 9l-6 6" />
    </svg>
  );
}