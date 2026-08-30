// src/components/AiAssistant.jsx
// Asistente personal del POS.
// Solo consulta y analiza información; no modifica datos del negocio.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AnimatePresence,
  motion,
} from "motion/react";

import {
  consultarAsistenteIa,
} from "../services/ai/assistantCloud";

import {
  buildAssistantBusinessContext,
} from "../services/ai/assistantContext";

const QUICK_PROMPTS = [
  "¿Cómo vendí hoy?",
  "¿Qué productos debería reponer?",
  "Resumime los últimos 7 días",
  "¿Cómo está mi caja ahora?",
];

function toDateMs(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value?.toMillis ===
    "function"
  ) {
    return value.toMillis();
  }

  if (
    typeof value?.toDate ===
    "function"
  ) {
    return value
      .toDate()
      .getTime();
  }

  if (
    typeof value === "object" &&
    Number.isFinite(
      Number(value?._seconds)
    )
  ) {
    return (
      Number(value._seconds) *
      1000
    );
  }

  const ms =
    Date.parse(
      String(value)
    );

  return Number.isFinite(ms)
    ? ms
    : null;
}

export function isAiAssistantEnabled(
  config
) {
  if (
    config?.enabled !== true
  ) {
    return false;
  }

  const untilMs =
    toDateMs(
      config?.enabledUntil
    );

  return (
    untilMs === null ||
    untilMs >= Date.now()
  );
}

function errorMessage(error) {
  const code =
    String(
      error?.code ||
        ""
    );

  const message =
    String(
      error?.message ||
        ""
    )
      .replace(
        /^FirebaseError:\s*/i,
        ""
      )
      .replace(
        /^functions\/[a-z-]+:\s*/i,
        ""
      )
      .trim();

  if (
    code.includes(
      "resource-exhausted"
    )
  ) {
    return (
      message ||
      "Alcanzaste el límite de consultas del asistente por este mes."
    );
  }

  if (
    code.includes(
      "permission-denied"
    )
  ) {
    return (
      message ||
      "El asistente IA no está habilitado para esta licencia."
    );
  }

  if (
    code.includes(
      "unavailable"
    ) ||
    code.includes(
      "deadline-exceeded"
    )
  ) {
    return "Gemini está demorando más de lo esperado. Intentá nuevamente en unos segundos.";
  }

  return (
    message ||
    "No se pudo consultar al asistente en este momento."
  );
}

function historyForApi(
  messages
) {
  return messages
    .filter(
      (message) =>
        message?.role ===
          "user" ||
        message?.role ===
          "assistant"
    )
    .slice(-6)
    .map(
      (message) => ({
        role:
          message.role,
        text:
          String(
            message.text ||
              ""
          ).slice(
            0,
            900
          ),
      })
    );
}

export default function AiAssistant({
  pos,
  config,
  operadorSesion,
  deviceId,
  launcherVisible = true,
}) {
  const [open, setOpen] =
    useState(false);

  const [input, setInput] =
    useState("");

  const [sending, setSending] =
    useState(false);

  const [messages, setMessages] =
    useState([]);

  const [usage, setUsage] =
    useState(null);

  const inputRef =
    useRef(null);

  const messagesEndRef =
    useRef(null);

  const sendingRef =
    useRef(false);

  const enabled =
    useMemo(
      () =>
        isAiAssistantEnabled(
          config
        ),
      [config]
    );

  useEffect(() => {
    if (!open) {
      return;
    }

    messagesEndRef.current
      ?.scrollIntoView?.({
        behavior: "smooth",
        block: "end",
      });
  }, [
    messages,
    open,
    sending,
  ]);

  if (!enabled) {
    return null;
  }

  async function sendQuestion(
    rawQuestion
  ) {
    const question =
      String(
        rawQuestion ||
          ""
      )
        .trim()
        .slice(0, 700);

    if (
      !question ||
      sendingRef.current
    ) {
      return;
    }

    if (
      pos?.isOnline ===
      false
    ) {
      setMessages(
        (current) => [
          ...current,
          {
            id:
              `error-${Date.now()}`,
            role: "error",
            text:
              "Necesitás conexión a Internet para consultar al asistente. El POS puede seguir funcionando con sus capacidades offline habituales.",
          },
        ]
      );

      return;
    }

    const previousMessages =
      messages;

    const userMessage = {
      id:
        `user-${Date.now()}`,
      role: "user",
      text: question,
    };

    setMessages(
      (current) => [
        ...current,
        userMessage,
      ]
    );

    setInput("");
    sendingRef.current =
      true;
    setSending(true);

    try {
      const contexto =
        buildAssistantBusinessContext(
          pos
        );

      const result =
        await consultarAsistenteIa({
          pregunta:
            question,
          historial:
            historyForApi(
              previousMessages
            ),
          contexto,
          operadorSesion,
          deviceId,
        });

      const answer =
        String(
          result?.respuesta ||
            ""
        ).trim();

      if (!answer) {
        throw new Error(
          "El asistente no devolvió una respuesta."
        );
      }

      setMessages(
        (current) => [
          ...current,
          {
            id:
              `assistant-${Date.now()}`,
            role:
              "assistant",
            text: answer,
          },
        ]
      );

      if (
        result?.uso &&
        typeof result.uso ===
          "object"
      ) {
        setUsage(
          result.uso
        );
      }
    } catch (error) {
      console.error(
        "Error consultando asistente IA:",
        error
      );

      setMessages(
        (current) => [
          ...current,
          {
            id:
              `error-${Date.now()}`,
            role: "error",
            text:
              errorMessage(
                error
              ),
          },
        ]
      );
    } finally {
      sendingRef.current =
        false;
      setSending(false);

      window.setTimeout(
        () =>
          inputRef.current
            ?.focus?.(),
        50
      );
    }
  }

  function clearConversation() {
    if (sending) {
      return;
    }

    setMessages([]);
    setUsage(null);
  }

  return (
    <>
      <AnimatePresence>
        {!open &&
          launcherVisible && (
            <motion.button
              type="button"
              initial={{
                opacity: 0,
                scale: 0.92,
                y: 8,
              }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                scale: 0.94,
              }}
              transition={{
                duration: 0.14,
              }}
              onClick={() =>
                setOpen(true)
              }
              className="
                fixed
                bottom-[calc(102px+env(safe-area-inset-bottom))]
                right-4
                z-30
                inline-flex
                h-12
                items-center
                gap-2
                rounded-2xl
                border
                border-[#FFC61A]/25
                bg-[#121720]/95
                px-4
                text-xs
                font-black
                text-white
                shadow-[0_18px_45px_rgba(0,0,0,0.34)]
                backdrop-blur-xl
                transition
                hover:border-[#FFC61A]/55
                active:scale-[0.97]
                lg:bottom-6
                lg:right-6
              "
              aria-label="Abrir asistente IA"
            >
              <SparklesIcon className="h-4 w-4 text-[#FFC61A]" />
              Asistente IA
            </motion.button>
          )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              initial={{
                opacity: 0,
              }}
              animate={{
                opacity: 1,
              }}
              exit={{
                opacity: 0,
              }}
              onClick={() => {
                if (!sending) {
                  setOpen(false);
                }
              }}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[3px]"
              aria-label="Cerrar asistente"
            />

            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Asistente IA del POS"
              initial={{
                opacity: 0,
                x: 26,
                scale: 0.985,
              }}
              animate={{
                opacity: 1,
                x: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                x: 24,
                scale: 0.985,
              }}
              transition={{
                duration: 0.16,
                ease: "easeOut",
              }}
              className="
                fixed
                bottom-2
                right-0
                top-2
                z-50
                flex
                w-[min(94vw,430px)]
                flex-col
                overflow-hidden
                rounded-l-[30px]
                border
                border-white/10
                bg-[#0D1118]
                text-white
                shadow-[-20px_0_70px_rgba(0,0,0,0.42)]
                sm:bottom-4
                sm:right-3
                sm:top-4
                sm:rounded-[30px]
              "
            >
              <div className="border-b border-white/8 px-4 pb-4 pt-4 sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black shadow-[0_10px_30px_rgba(255,198,26,0.16)]">
                    <SparklesIcon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#FFC61A]">
                      Copiloto del negocio
                    </p>
                    <h2 className="mt-1 truncate text-base font-black">
                      Asistente IA
                    </h2>
                    <p className="mt-0.5 text-[11px] text-white/40">
                      Solo lectura · no modifica caja ni stock
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setOpen(false)
                    }
                    disabled={sending}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/55 transition hover:text-white disabled:opacity-35"
                    aria-label="Cerrar asistente"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>

                {usage && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2 text-[10px] text-white/45">
                    <span>
                      Plan {String(usage.plan || config?.plan || "IA").toUpperCase()}
                    </span>
                    <span>
                      {Number(usage.restantes ?? 0)} consultas disponibles
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                {messages.length === 0 ? (
                  <div>
                    <div className="rounded-[24px] border border-[#FFC61A]/15 bg-[#FFC61A]/[0.055] p-4">
                      <p className="text-sm font-black text-white">
                        ¿Qué querés saber de tu negocio?
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed text-white/45">
                        Puedo analizar ventas, caja, inventario, ganancias registradas, cuentas y reposición usando el resumen sincronizado del POS.
                      </p>
                    </div>

                    <div className="mt-4 grid gap-2">
                      {QUICK_PROMPTS.map(
                        (prompt) => (
                          <button
                            type="button"
                            key={prompt}
                            onClick={() =>
                              sendQuestion(
                                prompt
                              )
                            }
                            disabled={sending}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.035] px-3.5 py-3 text-left text-xs font-bold text-white/70 transition hover:border-[#FFC61A]/25 hover:bg-white/[0.055] hover:text-white disabled:opacity-50"
                          >
                            <span>{prompt}</span>
                            <ChevronIcon className="h-4 w-4 shrink-0 text-[#FFC61A]" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map(
                      (message) => (
                        <div
                          key={message.id}
                          className={
                            message.role ===
                            "user"
                              ? "ml-auto max-w-[88%] rounded-[20px] rounded-br-md bg-[#FFC61A] px-3.5 py-3 text-sm font-semibold leading-relaxed text-black"
                              : message.role ===
                                  "error"
                                ? "max-w-[94%] rounded-[20px] border border-red-400/20 bg-red-500/10 px-3.5 py-3 text-sm leading-relaxed text-red-100"
                                : "max-w-[94%] rounded-[20px] rounded-bl-md border border-white/8 bg-white/[0.045] px-3.5 py-3 text-sm leading-relaxed text-white/80"
                          }
                        >
                          <div className="whitespace-pre-wrap break-words">
                            {message.text}
                          </div>
                        </div>
                      )
                    )}

                    {sending && (
                      <div className="flex max-w-[94%] items-center gap-2 rounded-[20px] rounded-bl-md border border-white/8 bg-white/[0.045] px-3.5 py-3 text-xs font-bold text-white/45">
                        <SpinnerIcon className="h-4 w-4 animate-spin text-[#FFC61A]" />
                        Analizando datos del POS…
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="border-t border-white/8 bg-[#0A0E14] px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4">
                {messages.length > 0 && (
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={clearConversation}
                      disabled={sending}
                      className="text-[10px] font-bold text-white/30 transition hover:text-white/60 disabled:opacity-30"
                    >
                      Limpiar conversación
                    </button>
                  </div>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendQuestion(input);
                  }}
                  className="flex items-end gap-2"
                >
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(event) =>
                      setInput(
                        event.target.value.slice(
                          0,
                          700
                        )
                      )
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key ===
                          "Enter" &&
                        !event.shiftKey &&
                        !event.isComposing
                      ) {
                        event.preventDefault();
                        sendQuestion(input);
                      }
                    }}
                    disabled={sending}
                    rows={1}
                    placeholder="Preguntale algo sobre tu negocio…"
                    className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#FFC61A]/45 disabled:opacity-55"
                  />

                  <button
                    type="submit"
                    disabled={
                      sending ||
                      !input.trim()
                    }
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black transition hover:bg-[#FFD248] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Enviar pregunta"
                  >
                    {sending ? (
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <SendIcon className="h-4 w-4" />
                    )}
                  </button>
                </form>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function SparklesIcon({
  className = "",
}) {
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
      <path d="m12 3-1.2 3.4a4 4 0 0 1-2.4 2.4L5 10l3.4 1.2a4 4 0 0 1 2.4 2.4L12 17l1.2-3.4a4 4 0 0 1 2.4-2.4L19 10l-3.4-1.2a4 4 0 0 1-2.4-2.4L12 3Z" />
      <path d="m5 3 .4 1.1a2 2 0 0 0 1.2 1.2L8 6l-1.4.7a2 2 0 0 0-1.2 1.2L5 9l-.4-1.1a2 2 0 0 0-1.2-1.2L2 6l1.4-.7a2 2 0 0 0 1.2-1.2L5 3Z" />
      <path d="m19 16 .6 1.6a2 2 0 0 0 1.2 1.2l1.2.6-1.2.6a2 2 0 0 0-1.2 1.2L19 23l-.6-1.8a2 2 0 0 0-1.2-1.2l-1.2-.6 1.2-.6a2 2 0 0 0 1.2-1.2L19 16Z" />
    </svg>
  );
}

function CloseIcon({
  className = "",
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({
  className = "",
}) {
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
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function SendIcon({
  className = "",
}) {
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
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function SpinnerIcon({
  className = "",
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
