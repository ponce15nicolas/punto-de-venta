import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

export default function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [toast, onDone]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.key}
          initial={{ opacity: 0, y: 10, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, y: 10, x: "-50%" }}
          className={
            "fixed bottom-[88px] left-1/2 font-bold text-[13px] px-4.5 py-2.5 rounded-full z-[200] shadow-lg " +
            (toast.error ? "bg-brick text-white" : "bg-leaf text-[#0E1712]")
          }
        >
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
