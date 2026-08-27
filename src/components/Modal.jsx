// src/components/Modal.jsx

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/* =========================================================
   CONTROL GLOBAL DEL SCROLL
========================================================= */

let modalScrollLocks = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";

/*
 * El stack permite que ESC cierre solamente el modal superior.
 * Es importante cuando un modal abre otro encima (confirmaciones,
 * escáner, etc.).
 */
const openModalStack = [];

const MODAL_FOCUSABLE_SELECTOR = [
  "input:not([disabled]):not([type='hidden'])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "button:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function lockBodyScroll() {
  if (
    typeof document === "undefined" ||
    typeof window === "undefined"
  ) {
    return;
  }

  if (modalScrollLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousBodyPaddingRight = document.body.style.paddingRight;

    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  modalScrollLocks += 1;
}

function unlockBodyScroll() {
  if (typeof document === "undefined") {
    return;
  }

  modalScrollLocks = Math.max(0, modalScrollLocks - 1);

  if (modalScrollLocks === 0) {
    document.body.style.overflow = previousBodyOverflow;
    document.body.style.paddingRight = previousBodyPaddingRight;

    previousBodyOverflow = "";
    previousBodyPaddingRight = "";
  }
}

function addModalToStack(token) {
  const existingIndex = openModalStack.indexOf(token);

  if (existingIndex >= 0) {
    openModalStack.splice(existingIndex, 1);
  }

  openModalStack.push(token);
}

function removeModalFromStack(token) {
  const index = openModalStack.lastIndexOf(token);

  if (index >= 0) {
    openModalStack.splice(index, 1);
  }
}

function isTopModal(token) {
  return openModalStack[openModalStack.length - 1] === token;
}

function isVisibleControl(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.dataset.modalSkipNav === "true") {
    return false;
  }

  if (element.closest('[aria-hidden="true"]')) {
    return false;
  }

  return element.getClientRects().length > 0;
}

function getModalControls(panel) {
  if (!panel) {
    return [];
  }

  return Array.from(
    panel.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)
  ).filter(isVisibleControl);
}

function focusControl(control) {
  if (!(control instanceof HTMLElement)) {
    return;
  }

  control.focus({ preventScroll: true });

  if (
    control instanceof HTMLInputElement &&
    control.type !== "checkbox" &&
    control.type !== "radio" &&
    control.type !== "date"
  ) {
    try {
      control.select();
    } catch {
      // Algunos tipos de input no permiten select().
    }
  }

  control.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: "auto",
  });
}

function focusFirstUsefulControl(panel) {
  if (!panel) {
    return;
  }

  const explicit = panel.querySelector(
    '[data-modal-autofocus="true"]'
  );

  if (isVisibleControl(explicit)) {
    focusControl(explicit);
    return;
  }

  const editable = Array.from(
    panel.querySelectorAll(
      "input:not([disabled]):not([type='hidden']), textarea:not([disabled]), select:not([disabled])"
    )
  ).find(isVisibleControl);

  if (editable) {
    focusControl(editable);
    return;
  }

  const firstAction = getModalControls(panel).find(
    (control) => control.dataset.modalClose !== "true"
  );

  if (firstAction) {
    focusControl(firstAction);
  }
}

function moveVerticalFocus(panel, direction) {
  const controls = getModalControls(panel);

  if (controls.length === 0) {
    return false;
  }

  const activeElement = document.activeElement;
  let currentIndex = controls.findIndex(
    (control) => control === activeElement
  );

  if (currentIndex < 0) {
    currentIndex = direction > 0 ? -1 : 0;
  }

  const nextIndex =
    (currentIndex + direction + controls.length) % controls.length;

  focusControl(controls[nextIndex]);
  return true;
}

function moveHorizontalFocus(activeElement, direction) {
  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  /*
   * En selects, ← / → cambia la opción sin abandonar el campo.
   * Así ↑ / ↓ quedan libres para recorrer el formulario completo.
   */
  if (activeElement instanceof HTMLSelectElement) {
    const enabledOptions = Array.from(activeElement.options).filter(
      (option) => !option.disabled
    );

    if (enabledOptions.length < 2) {
      return false;
    }

    const currentIndex = Math.max(
      0,
      enabledOptions.findIndex(
        (option) => option.value === activeElement.value
      )
    );

    const nextIndex =
      (currentIndex + direction + enabledOptions.length) %
      enabledOptions.length;

    activeElement.value = enabledOptions[nextIndex].value;
    activeElement.dispatchEvent(
      new Event("change", { bubbles: true })
    );
    return true;
  }

  const group = activeElement.closest(
    '[data-modal-horizontal-group="true"]'
  );

  if (!group) {
    return false;
  }

  const items = Array.from(
    group.querySelectorAll('[data-modal-horizontal-item="true"]')
  ).filter(isVisibleControl);

  if (items.length < 2) {
    return false;
  }

  const currentIndex = items.indexOf(activeElement);

  if (currentIndex < 0) {
    return false;
  }

  const nextIndex =
    (currentIndex + direction + items.length) % items.length;

  focusControl(items[nextIndex]);
  return true;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
}) {
  const prefersReducedMotion = useReducedMotion();
  const panelRef = useRef(null);
  const tokenRef = useRef(Symbol("pos-modal"));
  const previousFocusRef = useRef(null);

  const performanceMode =
    typeof document !== "undefined" &&
    document.documentElement.dataset.effects === "performance";

  const reduceMotion = prefersReducedMotion || performanceMode;

  /* =========================================================
     SCROLL + STACK + FOCO INICIAL
  ========================================================= */

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    lockBodyScroll();
    addModalToStack(tokenRef.current);

    previousFocusRef.current =
      typeof document !== "undefined"
        ? document.activeElement
        : null;

    let focusTimer = null;

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 760px), (pointer: fine)").matches
    ) {
      focusTimer = window.setTimeout(
        () => focusFirstUsefulControl(panelRef.current),
        reduceMotion ? 0 : 70
      );
    }

    return () => {
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer);
      }

      removeModalFromStack(tokenRef.current);
      unlockBodyScroll();

      const previousFocus = previousFocusRef.current;

      if (
        previousFocus &&
        typeof previousFocus.focus === "function" &&
        document.contains(previousFocus)
      ) {
        window.setTimeout(() => {
          previousFocus.focus({ preventScroll: true });
        }, 0);
      }
    };
  }, [open, reduceMotion]);

  /* =========================================================
     TECLADO GLOBAL DEL MODAL

     ESC      -> cierra solamente el modal superior
     ↑ / ↓    -> recorre controles/campos
     ← / →    -> recorre grupos horizontales marcados
  ========================================================= */

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return undefined;
    }

    function handleKeyDown(event) {
      if (!isTopModal(tokenRef.current)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose?.();
        return;
      }

      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const direction = event.key === "ArrowDown" ? 1 : -1;

        if (moveVerticalFocus(panelRef.current, direction)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }

        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const direction = event.key === "ArrowRight" ? 1 : -1;

        if (moveHorizontalFocus(document.activeElement, direction)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, onClose]);

  /* =========================================================
     PORTAL
  ========================================================= */

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="
            pos-modal-overlay
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
          initial={
            reduceMotion
              ? false
              : {
                  opacity: 0,
                }
          }
          animate={{
            opacity: 1,
          }}
          exit={
            reduceMotion
              ? {
                  opacity: 1,
                }
              : {
                  opacity: 0,
                }
          }
          transition={{
            duration: reduceMotion ? 0 : 0.18,
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose?.();
            }
          }}
        >
          <motion.div
            ref={panelRef}
            className="
              pos-modal-panel
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
            initial={
              reduceMotion
                ? false
                : {
                    y: "100%",
                    opacity: 0.98,
                  }
            }
            animate={{
              y: 0,
              opacity: 1,
            }}
            exit={
              reduceMotion
                ? {
                    y: 0,
                    opacity: 1,
                  }
                : {
                    y: "100%",
                    opacity: 0.98,
                  }
            }
            transition={
              reduceMotion
                ? {
                    duration: 0,
                  }
                : {
                    type: "spring",
                    stiffness: 400,
                    damping: 38,
                  }
            }
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
                data-modal-close="true"
                data-modal-skip-nav="true"
                onClick={() => onClose?.()}
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
