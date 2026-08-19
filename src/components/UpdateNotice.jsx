import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AnimatePresence,
  motion,
} from "motion/react";

const CHECK_INTERVAL_MS =
  5 * 60 * 1000;

const CHECK_RETRY_DELAY_MS =
  15 * 1000;

const CURRENT_BUILD_ID =
  String(
    import.meta.env
      .VITE_APP_BUILD_ID ||
      "dev"
  ).trim();

function buildVersionUrl() {
  const url = new URL(
    "/version.json",
    window.location.origin
  );

  url.searchParams.set(
    "t",
    String(Date.now())
  );

  return url.toString();
}

function hardRefresh() {
  const url = new URL(
    window.location.href
  );

  url.searchParams.set(
    "_update",
    String(Date.now())
  );

  window.location.replace(
    url.toString()
  );
}

export default function UpdateNotice() {
  const [availableBuildId, setAvailableBuildId] =
    useState("");
  const [dismissedBuildId, setDismissedBuildId] =
    useState("");

  const checkingRef = useRef(false);
  const retryTimerRef = useRef(null);

  const checkForUpdate =
    useCallback(async () => {
      if (
        checkingRef.current ||
        CURRENT_BUILD_ID === "dev"
      ) {
        return;
      }

      checkingRef.current = true;

      try {
        const response = await fetch(
          buildVersionUrl(),
          {
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          return;
        }

        const contentType =
          response.headers.get(
            "content-type"
          ) || "";

        if (
          !contentType.includes(
            "application/json"
          )
        ) {
          return;
        }

        const payload =
          await response.json();

        const remoteBuildId =
          String(
            payload?.buildId || ""
          ).trim();

        if (
          remoteBuildId &&
          remoteBuildId !==
            CURRENT_BUILD_ID
        ) {
          setAvailableBuildId(
            remoteBuildId
          );
          return;
        }

        setAvailableBuildId("");
        setDismissedBuildId("");
      } catch {
        clearTimeout(
          retryTimerRef.current
        );

        retryTimerRef.current =
          window.setTimeout(
            () => {
              checkForUpdate();
            },
            CHECK_RETRY_DELAY_MS
          );
      } finally {
        checkingRef.current = false;
      }
    }, []);

  useEffect(() => {
    const initialTimer =
      window.setTimeout(
        () => {
          checkForUpdate();
        },
        2500
      );

    const interval =
      window.setInterval(
        checkForUpdate,
        CHECK_INTERVAL_MS
      );

    function handleFocus() {
      checkForUpdate();
    }

    function handleVisibilityChange() {
      if (
        document.visibilityState ===
        "visible"
      ) {
        checkForUpdate();
      }
    }

    window.addEventListener(
      "focus",
      handleFocus
    );

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    return () => {
      window.clearTimeout(
        initialTimer
      );
      window.clearTimeout(
        retryTimerRef.current
      );
      window.clearInterval(
        interval
      );

      window.removeEventListener(
        "focus",
        handleFocus
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [checkForUpdate]);

  const visible =
    Boolean(availableBuildId) &&
    availableBuildId !==
      dismissedBuildId;

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.18,
              ease: "easeOut",
            }}
            className="
              fixed
              inset-0
              z-[70]
              bg-black/40
              backdrop-blur-[6px]
            "
            aria-hidden="true"
          />

          <motion.aside
          initial={{
            opacity: 0,
            y: 18,
            scale: 0.98,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            y: 12,
            scale: 0.98,
          }}
          transition={{
            duration: 0.2,
            ease: "easeOut",
          }}
          className="
            fixed
            bottom-[calc(112px+env(safe-area-inset-bottom))]
            left-1/2
            z-[80]
            w-[calc(100%-28px)]
            max-w-[460px]
            -translate-x-1/2
            overflow-hidden
            rounded-[24px]
            border
            border-[#FFC61A]/20
            bg-[#151A22]/95
            shadow-[0_22px_70px_rgba(0,0,0,0.5)]
            backdrop-blur-xl
            sm:bottom-[92px]
          "
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-notice-title"
          aria-describedby="update-notice-description"
        >
          <div
            className="
              h-[3px]
              w-full
              bg-[#FFC61A]
            "
          />

          <div className="p-4">
            <div
              className="
                flex
                items-start
                gap-3
              "
            >
              <div
                className="
                  grid
                  h-11
                  w-11
                  shrink-0
                  place-items-center
                  rounded-2xl
                  bg-[#FFC61A]
                  text-black
                  shadow-[0_10px_30px_rgba(255,198,26,0.16)]
                "
              >
                <UpdateIcon className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="
                    text-[9px]
                    font-extrabold
                    uppercase
                    tracking-[0.16em]
                    text-[#FFC61A]
                  "
                >
                  Actualización del sistema
                </p>

                <h3
                  id="update-notice-title"
                  className="
                    mt-1
                    text-[15px]
                    font-black
                    tracking-[-0.01em]
                    text-white
                  "
                >
                  Nueva actualización disponible
                </h3>

                <p
                  id="update-notice-description"
                  className="
                    mt-1.5
                    text-xs
                    leading-relaxed
                    text-white/45
                  "
                >
                  Hay una versión más reciente del POS lista para usar.
                </p>
              </div>
            </div>

            <div
              className="
                mt-4
                grid
                grid-cols-[0.8fr_1.2fr]
                gap-2.5
              "
            >
              <button
                type="button"
                onClick={() =>
                  setDismissedBuildId(
                    availableBuildId
                  )
                }
                className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-white/[0.045]
                  px-3
                  py-3
                  text-xs
                  font-extrabold
                  text-white/55
                  transition
                  hover:bg-white/[0.08]
                  hover:text-white/75
                  active:scale-[0.98]
                "
              >
                Más tarde
              </button>

              <button
                type="button"
                onClick={hardRefresh}
                className="
                  inline-flex
                  items-center
                  justify-center
                  gap-2
                  rounded-2xl
                  bg-[#FFC61A]
                  px-3
                  py-3
                  text-xs
                  font-black
                  text-black
                  shadow-[0_10px_28px_rgba(255,198,26,0.14)]
                  transition
                  hover:bg-[#FFD248]
                  active:scale-[0.98]
                "
              >
                <RefreshIcon className="h-4 w-4" />
                Actualizar ahora
              </button>
            </div>
          </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function UpdateIcon({
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
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function RefreshIcon({
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
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.5 9A7 7 0 0 0 6.3 6.3L4 8" />
      <path d="M5.5 15A7 7 0 0 0 17.7 17.7L20 16" />
    </svg>
  );
}
