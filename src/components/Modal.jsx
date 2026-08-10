import { AnimatePresence, motion } from "motion/react";

export default function Modal({ open, onClose, title, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 bg-black/70 z-[100] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="relative bg-surface w-full max-w-[520px] rounded-t-2xl px-4 pt-4.5 pb-[calc(20px+env(safe-area-inset-bottom))] max-h-[88vh] overflow-y-auto"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 38 }}
          >
            <button
              className="absolute top-3.5 right-4 bg-transparent border-none text-cream-dim text-xl cursor-pointer"
              onClick={onClose}
            >
              ✕
            </button>
            <h2 className="font-display text-[17px] mb-3.5">{title}</h2>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
