// src/components/AiAssistant.jsx
// Asistente personal del POS.
// Consulta, analiza y puede proponer acciones que siempre requieren confirmación explícita.

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
  "Dame un resumen ejecutivo de hoy",
  "Compará los últimos 7 días con los 7 anteriores",
  "¿Qué debería reponer primero y cuánto?",
  "Explicame el estado de caja y las últimas diferencias",
  "¿Qué alertas requieren atención ahora?",
  "Armame una lista de compras con lo que debería reponer",
  "¿Qué compras pendientes puedo confirmar?",
  "¿Qué cuentas por pagar requieren atención?",
  "¿Qué cuentas por cobrar están vencidas?",
];

const MONEY_FORMATTER =
  new Intl.NumberFormat(
    "es-AR",
    {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }
  );

function formatMoney(value) {
  const number = Number(value);

  return MONEY_FORMATTER.format(
    Number.isFinite(number)
      ? number
      : 0
  );
}

function formatVariation(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return "Sin base";
  }

  const number =
    Number(value);

  return `${number > 0 ? "+" : ""}${number}%`;
}

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

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

function getActiveUiTheme() {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement?.dataset?.theme === "light"
    ? "light"
    : "dark";
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

  const [uiTheme, setUiTheme] =
    useState(() =>
      getActiveUiTheme()
    );

  const [input, setInput] =
    useState("");

  const [sending, setSending] =
    useState(false);

  const [messages, setMessages] =
    useState([]);

  const [usage, setUsage] =
    useState(null);

  const [executingActionId, setExecutingActionId] =
    useState(null);

  const actionExecutingRef =
    useRef(false);

  const inputRef =
    useRef(null);

  const messagesEndRef =
    useRef(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const syncTheme = () => {
      setUiTheme(
        getActiveUiTheme()
      );
    };

    syncTheme();

    const observer =
      new MutationObserver(
        syncTheme
      );

    observer.observe(
      document.documentElement,
      {
        attributes: true,
        attributeFilter: [
          "data-theme",
        ],
      }
    );

    return () => {
      observer.disconnect();
    };
  }, []);

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

  const businessContext =
    useMemo(
      () =>
        buildAssistantBusinessContext(
          pos
        ),
      [
        pos?.sales,
        pos?.catalog,
        pos?.openSession,
        pos?.cashSessions,
        pos?.accountsReceivable,
        pos?.accountsPayable,
        pos?.shoppingList,
        pos?.promotions,
        pos?.isOnline,
        pos?.pendingOfflineCount,
        pos?.shopName,
        pos?.paymentBreakdown,
      ]
    );

  const alerts =
    Array.isArray(
      businessContext?.alertas
    )
      ? businessContext.alertas
      : [];

  const attentionAlertCount =
    alerts.filter(
      (alert) =>
        alert?.severidad ===
          "alta" ||
        alert?.severidad ===
          "media"
    ).length;

  const todaySummary =
    businessContext
      ?.ventas?.hoy || {};

  const weekVariation =
    businessContext
      ?.ventas
      ?.comparaciones
      ?.ultimos7Vs7Anteriores
      ?.facturacionVariacionPct;

  const currentCash =
    businessContext
      ?.caja?.actual || {};

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
      /*
       * Para preguntas concretas (por ejemplo stock de un producto),
       * generamos un contexto de consulta que agrega únicamente las
       * coincidencias relevantes del catálogo actual. Así evitamos
       * enviar todo el inventario a Gemini y mantenemos respuestas
       * precisas incluso con catálogos grandes.
       */
      const requestContext =
        buildAssistantBusinessContext(
          pos,
          {
            question,
          }
        );

      const result =
        await consultarAsistenteIa({
          pregunta:
            question,
          historial:
            historyForApi(
              previousMessages
            ),
          contexto:
            requestContext,
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
            action:
              result?.accionPropuesta &&
              typeof result.accionPropuesta ===
                "object"
                ? result.accionPropuesta
                : null,
            actionStatus:
              result?.accionPropuesta
                ? "pending"
                : null,
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

  function updateActionMessage(
    messageId,
    patch
  ) {
    setMessages(
      (current) =>
        current.map(
          (message) =>
            message.id ===
            messageId
              ? {
                  ...message,
                  ...patch,
                }
              : message
        )
    );
  }

  function cancelProposedAction(
    message
  ) {
    if (
      !message?.id ||
      message?.actionStatus !==
        "pending" ||
      actionExecutingRef.current
    ) {
      return;
    }

    updateActionMessage(
      message.id,
      {
        actionStatus:
          "cancelled",
        actionResult:
          "Acción cancelada. No se modificó ningún dato.",
      }
    );
  }

  async function executeProposedAction(
    message
  ) {
    const action =
      message?.action;

    if (
      !message?.id ||
      !action ||
      message?.actionStatus !==
        "pending" ||
      actionExecutingRef.current
    ) {
      return;
    }

    if (
      pos?.isOnline ===
      false
    ) {
      updateActionMessage(
        message.id,
        {
          actionStatus:
            "error",
          actionResult:
            "Necesitás conexión a Internet para ejecutar esta acción.",
        }
      );
      return;
    }

    if (
      action?.destructiva ===
        true ||
      action?.riesgo ===
        "alto"
    ) {
      const confirmed =
        window.confirm(
          `${action?.descripcion || "Esta acción modifica información sensible."}\n\n${action?.destructiva === true ? "Esta acción puede ser irreversible. " : "Esta operación afecta movimientos financieros o datos sensibles. "}¿Confirmás que querés continuar?`
        );

      if (!confirmed) {
        return;
      }
    }

    actionExecutingRef.current =
      true;
    setExecutingActionId(
      message.id
    );

    try {
      if (
        action.tipo ===
        "sumar_stock"
      ) {
        if (
          typeof pos?.restock !==
          "function"
        ) {
          throw new Error(
            "La función de reposición no está disponible."
          );
        }

        const ok =
          await Promise.resolve(
            pos.restock(
              action?.payload
                ?.barcode,
              action?.payload
                ?.cantidad
            )
          );

        if (!ok) {
          throw new Error(
            "No se pudo actualizar el stock."
          );
        }

        updateActionMessage(
          message.id,
          {
            actionStatus:
              "success",
            actionResult:
              `Stock actualizado: ${action?.payload?.productoNombre || "producto"} quedó con aproximadamente ${action?.payload?.stockResultante ?? "el nuevo stock"} ${action?.payload?.unidad || "unidades"}.`,
          }
        );
        return;
      }

      if (
        action.tipo ===
        "crear_lista_compras"
      ) {
        if (
          typeof pos?.createShoppingItem !==
          "function"
        ) {
          throw new Error(
            "La lista de compras no está disponible."
          );
        }

        const items =
          Array.isArray(
            action?.payload
              ?.items
          )
            ? action.payload.items
            : [];

        if (items.length === 0) {
          throw new Error(
            "La acción no contiene ítems válidos."
          );
        }

        let completed = 0;

        for (const item of items) {
          const ok =
            await Promise.resolve(
              pos.createShoppingItem(
                item
              )
            );

          if (!ok) {
            break;
          }

          completed += 1;
        }

        if (
          completed ===
          items.length
        ) {
          updateActionMessage(
            message.id,
            {
              actionStatus:
                "success",
              actionResult:
                completed === 1
                  ? "Ítem agregado a la lista de compras."
                  : `${completed} ítems agregados a la lista de compras.`,
            }
          );
          return;
        }

        if (completed > 0) {
          updateActionMessage(
            message.id,
            {
              actionStatus:
                "partial",
              actionResult:
                `Se agregaron ${completed} de ${items.length} ítems. La acción quedó detenida para evitar duplicados; revisá la lista antes de volver a intentarlo.`,
            }
          );
          return;
        }

        throw new Error(
          "No se pudo crear la lista de compras."
        );
      }

      if (
        action.tipo ===
        "confirmar_compra"
      ) {
        if (
          typeof pos?.completeShoppingItem !==
          "function"
        ) {
          throw new Error(
            "La confirmación de compras no está disponible."
          );
        }

        const payload =
          action?.payload || {};

        const ok =
          await Promise.resolve(
            pos.completeShoppingItem(
              payload.compraId,
              {
                costoReal:
                  payload.costoReal,
                conceptoCosto:
                  payload.conceptoCosto,
                sumarStock:
                  payload.sumarStock ===
                  true,
                productoBarcode:
                  payload.sumarStock
                    ? payload.productoBarcode
                    : "",
                cantidadStock:
                  payload.sumarStock
                    ? payload.cantidadStock
                    : 0,
                generarCuentaPorPagar:
                  payload.generarCuentaPorPagar ===
                  true,
                vencimiento:
                  payload.vencimiento ||
                  "",
              }
            )
          );

        if (!ok) {
          throw new Error(
            "No se pudo confirmar la compra."
          );
        }

        updateActionMessage(
          message.id,
          {
            actionStatus:
              "success",
            actionResult:
              payload.generarCuentaPorPagar
                ? "Compra confirmada. Se actualizó la información correspondiente y se creó la cuenta por pagar."
                : payload.sumarStock
                  ? "Compra confirmada y stock actualizado."
                  : "Compra confirmada correctamente.",
          }
        );
        return;
      }

      if (
        action.tipo ===
        "crear_cuenta_por_pagar"
      ) {
        if (
          typeof pos?.createManualPayable !==
          "function"
        ) {
          throw new Error(
            "La gestión de cuentas por pagar no está disponible."
          );
        }

        const ok =
          await Promise.resolve(
            pos.createManualPayable(
              action?.payload?.cuenta
            )
          );

        if (!ok) {
          throw new Error(
            "No se pudo crear la cuenta por pagar."
          );
        }

        updateActionMessage(
          message.id,
          {
            actionStatus:
              "success",
            actionResult:
              "Cuenta por pagar registrada correctamente.",
          }
        );
        return;
      }

      if (
        action.tipo ===
        "registrar_pago_cuenta_por_pagar"
      ) {
        if (
          typeof pos?.registerPayablePayment !==
          "function"
        ) {
          throw new Error(
            "El registro de pagos a proveedores no está disponible."
          );
        }

        const payload =
          action?.payload || {};

        const ok =
          await Promise.resolve(
            pos.registerPayablePayment(
              payload.cuentaId,
              {
                importe:
                  payload.importe,
                metodoPago:
                  payload.metodoPago,
              }
            )
          );

        if (!ok) {
          throw new Error(
            "No se pudo registrar el pago de la cuenta por pagar."
          );
        }

        updateActionMessage(
          message.id,
          {
            actionStatus:
              "success",
            actionResult:
              payload.saldoResultante === 0
                ? "Pago registrado. La cuenta por pagar quedó saldada."
                : `Pago registrado. Saldo restante estimado: ${formatMoney(payload.saldoResultante)}.`,
          }
        );
        return;
      }

      if (
        action.tipo ===
        "crear_cuenta_por_cobrar"
      ) {
        if (
          typeof pos?.createManualReceivable !==
          "function"
        ) {
          throw new Error(
            "La gestión de cuentas por cobrar no está disponible."
          );
        }

        const ok =
          await Promise.resolve(
            pos.createManualReceivable(
              action?.payload?.cuenta
            )
          );

        if (!ok) {
          throw new Error(
            "No se pudo crear la cuenta por cobrar."
          );
        }

        updateActionMessage(
          message.id,
          {
            actionStatus:
              "success",
            actionResult:
              "Cuenta por cobrar registrada correctamente.",
          }
        );
        return;
      }

      if (
        action.tipo ===
        "registrar_pago_cuenta_por_cobrar"
      ) {
        if (
          typeof pos?.registerReceivablePayment !==
          "function"
        ) {
          throw new Error(
            "El registro de cobros no está disponible."
          );
        }

        const payload =
          action?.payload || {};

        const ok =
          await Promise.resolve(
            pos.registerReceivablePayment(
              payload.cuenta,
              {
                importe:
                  payload.importe,
                metodoPago:
                  payload.metodoPago,
                efectivoRecibido:
                  payload.metodoPago ===
                  "efectivo"
                    ? payload.efectivoRecibido
                    : null,
                vuelto:
                  payload.metodoPago ===
                  "efectivo"
                    ? payload.vuelto
                    : 0,
              }
            )
          );

        if (!ok) {
          throw new Error(
            "No se pudo registrar el cobro."
          );
        }

        updateActionMessage(
          message.id,
          {
            actionStatus:
              "success",
            actionResult:
              payload.saldoResultante === 0
                ? "Cobro registrado. La cuenta por cobrar quedó saldada."
                : `Cobro registrado. Saldo restante estimado: ${formatMoney(payload.saldoResultante)}.`,
          }
        );
        return;
      }

      if (
        action.tipo ===
        "eliminar_cierre_historial"
      ) {
        if (
          typeof pos?.deleteCashSession !==
          "function"
        ) {
          throw new Error(
            "La eliminación de cierres no está disponible."
          );
        }

        const ok =
          await Promise.resolve(
            pos.deleteCashSession(
              action?.payload
                ?.cajaId
            )
          );

        if (!ok) {
          throw new Error(
            "No se pudo eliminar el cierre. Esta acción requiere permisos de Administrador."
          );
        }

        updateActionMessage(
          message.id,
          {
            actionStatus:
              "success",
            actionResult:
              "Cierre histórico eliminado. La auditoría de la eliminación se conserva.",
          }
        );
        return;
      }

      throw new Error(
        "El asistente propuso una acción no compatible."
      );
    } catch (error) {
      console.error(
        "Error ejecutando acción del asistente IA:",
        error
      );

      updateActionMessage(
        message.id,
        {
          actionStatus:
            "error",
          actionResult:
            String(
              error?.message ||
                "No se pudo ejecutar la acción."
            ),
        }
      );
    } finally {
      actionExecutingRef.current =
        false;
      setExecutingActionId(
        null
      );
    }
  }

  const isLightTheme =
    uiTheme === "light";

  const launcherClassName =
    cn(
      "group fixed bottom-[calc(102px+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-[54px] items-center gap-2.5 overflow-hidden rounded-[20px] px-2.5 pr-3.5 text-left shadow-[0_18px_46px_rgba(0,0,0,0.20)] backdrop-blur-2xl transition-[transform,border-color,box-shadow] duration-200 active:scale-[0.97] lg:bottom-6 lg:right-6",
      isLightTheme
        ? "border border-[#D6C28B] bg-[linear-gradient(135deg,rgba(255,251,240,0.97),rgba(247,240,222,0.94))] text-[#161B22] shadow-[0_18px_42px_rgba(177,138,34,0.16),0_0_0_1px_rgba(255,198,26,0.08)] hover:border-[#D2A826]/55 hover:shadow-[0_22px_52px_rgba(177,138,34,0.22),0_0_20px_rgba(255,198,26,0.12)]"
        : "border border-white/10 bg-[linear-gradient(135deg,rgba(23,28,39,0.96),rgba(11,13,18,0.94))] text-white shadow-[0_18px_46px_rgba(0,0,0,0.36),0_0_0_1px_rgba(255,198,26,0.04)] hover:border-[#FFC61A]/30 hover:shadow-[0_20px_52px_rgba(0,0,0,0.42),0_0_24px_rgba(255,198,26,0.10)]"
    );

  const panelClassName =
    cn(
      "fixed bottom-2 right-0 top-2 z-50 flex w-[min(94vw,430px)] flex-col overflow-hidden rounded-l-[30px] border shadow-[-20px_0_70px_rgba(0,0,0,0.22)] sm:bottom-4 sm:right-3 sm:top-4 sm:rounded-[30px]",
      isLightTheme
        ? "border-[#E3D7B0] bg-[#F6F2E8] text-[#131922]"
        : "border-white/10 bg-[#0D1118] text-white shadow-[-20px_0_70px_rgba(0,0,0,0.42)]"
    );

  function clearConversation() {
    if (
      sending ||
      actionExecutingRef.current
    ) {
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
              className={launcherClassName}
              aria-label="Abrir asistente IA"
            >
              <span
                className={cn("relative grid h-9 w-9 shrink-0 place-items-center rounded-[14px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition duration-200", isLightTheme ? "border-[#D6C28B] bg-[#FFF0B3] group-hover:bg-[#FFE38A]" : "border-[#FFC61A]/20 bg-[#FFC61A]/10 group-hover:bg-[#FFC61A]/15")}
              >
                <SparklesIcon className="h-[17px] w-[17px] text-[#FFC61A]" />
                <span
                  className="
                    absolute
                    -right-0.5
                    -top-0.5
                    h-2
                    w-2
                    rounded-full
                    bg-[#FFC61A]
                    shadow-[0_0_10px_rgba(255,198,26,0.7)]
                  "
                />
              </span>

              <span className="min-w-0 leading-none">
                <span
                  className={cn("block text-[8px] font-extrabold uppercase tracking-[0.18em]", isLightTheme ? "text-black/40" : "text-white/35")}
                >
                  Copiloto
                </span>
                <span
                  className={cn("mt-1 block whitespace-nowrap text-[12px] font-black tracking-[-0.01em]", isLightTheme ? "text-[#161B22]" : "text-white")}
                >
                  Asistente IA
                </span>
              </span>

              {attentionAlertCount > 0 && (
                <span
                  className="
                    ml-0.5
                    grid
                    min-w-[22px]
                    place-items-center
                    rounded-full
                    border
                    border-[#FFC61A]/20
                    bg-[#FFC61A]
                    px-1.5
                    py-1
                    text-[9px]
                    font-black
                    leading-none
                    text-black
                    shadow-[0_0_16px_rgba(255,198,26,0.18)]
                  "
                  aria-label={`${attentionAlertCount} alertas del asistente`}
                >
                  {Math.min(
                    attentionAlertCount,
                    9
                  )}
                </span>
              )}
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
              className={cn("fixed inset-0 z-40 backdrop-blur-[3px]", isLightTheme ? "bg-[#1D1400]/20" : "bg-black/55")}
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
              className={panelClassName}
            >
              <div className={cn("border-b px-4 pb-4 pt-4 sm:px-5", isLightTheme ? "border-black/8 bg-[#F6F2E8]" : "border-white/8")}>
                <div className="flex items-center gap-3">
                  <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black shadow-[0_10px_30px_rgba(255,198,26,0.16)]", isLightTheme ? "ring-1 ring-[#D9BC65]/45" : "")}>
                    <SparklesIcon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#FFC61A]">
                      Copiloto del negocio
                    </p>
                    <h2 className="mt-1 truncate text-base font-black">
                      Asistente IA
                    </h2>
                    <p className={cn("mt-0.5 text-[11px]", isLightTheme ? "text-black/50" : "text-white/40")}>
                      Acciones con confirmación · auditoría protegida
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setOpen(false)
                    }
                    disabled={sending}
                    className={cn("grid h-9 w-9 place-items-center rounded-xl border transition disabled:opacity-35", isLightTheme ? "border-black/10 bg-black/[0.035] text-black/55 hover:bg-black/[0.05] hover:text-black" : "border-white/10 bg-white/5 text-white/55 hover:text-white")}
                    aria-label="Cerrar asistente"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>

                {usage && (
                  <div className={cn("mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-[10px]", isLightTheme ? "border-black/8 bg-black/[0.03] text-black/55" : "border-white/8 bg-white/[0.035] text-white/45")}>
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
                    <div className={cn("rounded-[24px] border p-4", isLightTheme ? "border-[#D6C28B] bg-[linear-gradient(180deg,rgba(255,246,219,0.88),rgba(255,250,238,0.94))]" : "border-[#FFC61A]/15 bg-[#FFC61A]/[0.055]")}>
                      <p className={cn("text-sm font-black", isLightTheme ? "text-[#151922]" : "text-white")}>
                        ¿Qué querés saber de tu negocio?
                      </p>
                      <p className={cn("mt-1.5 text-xs leading-relaxed", isLightTheme ? "text-black/55" : "text-white/45")}>
                        Ahora puedo comparar períodos equivalentes, estimar reposición por ritmo de venta, revisar alertas y explicar el efectivo esperado de caja.
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className={cn("rounded-2xl border p-3", isLightTheme ? "border-black/8 bg-white/80 shadow-[0_6px_18px_rgba(17,24,39,0.04)]" : "border-white/8 bg-white/[0.035]")}>
                        <p className={cn("text-[9px] font-black uppercase tracking-[0.12em]", isLightTheme ? "text-black/35" : "text-white/30")}>
                          Hoy
                        </p>
                        <p className={cn("mt-1 truncate text-xs font-black", isLightTheme ? "text-[#141922]" : "text-white/85")}>
                          {formatMoney(
                            todaySummary.facturacion
                          )}
                        </p>
                        <p className={cn("mt-1 text-[9px]", isLightTheme ? "text-black/40" : "text-white/35")}>
                          {Number(
                            todaySummary.operaciones ||
                              0
                          )} operaciones
                        </p>
                      </div>

                      <div className={cn("rounded-2xl border p-3", isLightTheme ? "border-black/8 bg-white/80 shadow-[0_6px_18px_rgba(17,24,39,0.04)]" : "border-white/8 bg-white/[0.035]")}>
                        <p className={cn("text-[9px] font-black uppercase tracking-[0.12em]", isLightTheme ? "text-black/35" : "text-white/30")}>
                          Tendencia 7d
                        </p>
                        <p className={cn("mt-1 text-xs font-black", isLightTheme ? "text-[#141922]" : "text-white/85")}>
                          {formatVariation(
                            weekVariation
                          )}
                        </p>
                        <p className={cn("mt-1 text-[9px]", isLightTheme ? "text-black/40" : "text-white/35")}>
                          vs. 7d anteriores
                        </p>
                      </div>

                      <div className={cn("rounded-2xl border p-3", isLightTheme ? "border-black/8 bg-white/80 shadow-[0_6px_18px_rgba(17,24,39,0.04)]" : "border-white/8 bg-white/[0.035]")}>
                        <p className={cn("text-[9px] font-black uppercase tracking-[0.12em]", isLightTheme ? "text-black/35" : "text-white/30")}>
                          Caja
                        </p>
                        <p className={cn("mt-1 truncate text-xs font-black", isLightTheme ? "text-[#141922]" : "text-white/85")}>
                          {currentCash.abierta
                            ? formatMoney(
                                currentCash.efectivoEsperado
                              )
                            : "Cerrada"}
                        </p>
                        <p className={cn("mt-1 text-[9px]", isLightTheme ? "text-black/40" : "text-white/35")}>
                          {currentCash.abierta
                            ? "efectivo esperado"
                            : "sin turno abierto"}
                        </p>
                      </div>
                    </div>

                    {alerts.length > 0 && (
                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className={cn("text-[10px] font-black uppercase tracking-[0.14em]", isLightTheme ? "text-black/40" : "text-white/35")}>
                            Alertas detectadas
                          </p>
                          <span className={cn("text-[9px] font-bold", isLightTheme ? "text-black/30" : "text-white/25")}>
                            {alerts.length}
                          </span>
                        </div>

                        <div className="grid gap-2">
                          {alerts
                            .slice(0, 3)
                            .map(
                              (alert) => (
                                <button
                                  type="button"
                                  key={alert.id}
                                  onClick={() =>
                                    sendQuestion(
                                      alert.preguntaSugerida ||
                                        "Analizá esta alerta y decime qué debería revisar."
                                    )
                                  }
                                  disabled={sending}
                                  className={
                                    alert.severidad ===
                                    "alta"
                                      ? isLightTheme ? "rounded-2xl border border-red-300/50 bg-red-50 px-3.5 py-3 text-left transition hover:bg-red-100 disabled:opacity-50" : "rounded-2xl border border-red-400/20 bg-red-500/[0.07] px-3.5 py-3 text-left transition hover:bg-red-500/[0.11] disabled:opacity-50"
                                      : isLightTheme ? "rounded-2xl border border-[#D6C28B] bg-white/85 px-3.5 py-3 text-left transition hover:bg-[#FFF7DE] disabled:opacity-50" : "rounded-2xl border border-[#FFC61A]/15 bg-[#FFC61A]/[0.035] px-3.5 py-3 text-left transition hover:bg-[#FFC61A]/[0.065] disabled:opacity-50"
                                  }
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className={cn("text-xs font-black", isLightTheme ? "text-[#151922]" : "text-white/85")}>
                                        {alert.titulo}
                                      </p>
                                      <p className={cn("mt-1 text-[10px] leading-relaxed", isLightTheme ? "text-black/50" : "text-white/40")}>
                                        {alert.detalle}
                                      </p>
                                    </div>
                                    <ChevronIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC61A]" />
                                  </div>
                                </button>
                              )
                            )}
                        </div>
                      </div>
                    )}

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
                            className={cn("flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-left text-xs font-bold transition disabled:opacity-50", isLightTheme ? "border-black/8 bg-white/80 text-black/70 hover:border-[#D2A826]/35 hover:bg-[#FFF7DE] hover:text-black" : "border-white/8 bg-white/[0.035] text-white/70 hover:border-[#FFC61A]/25 hover:bg-white/[0.055] hover:text-white")}
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
                              ? "ml-auto max-w-[88%] rounded-[20px] rounded-br-md bg-[#FFC61A] px-3.5 py-3 text-sm font-semibold leading-relaxed text-black shadow-[0_8px_18px_rgba(255,198,26,0.14)]"
                              : message.role ===
                                  "error"
                                ? isLightTheme ? "max-w-[94%] rounded-[20px] border border-red-300/50 bg-red-50 px-3.5 py-3 text-sm leading-relaxed text-red-700" : "max-w-[94%] rounded-[20px] border border-red-400/20 bg-red-500/10 px-3.5 py-3 text-sm leading-relaxed text-red-100"
                                : isLightTheme ? "max-w-[94%] rounded-[20px] rounded-bl-md border border-black/8 bg-white/85 px-3.5 py-3 text-sm leading-relaxed text-black/80 shadow-[0_8px_18px_rgba(17,24,39,0.04)]" : "max-w-[94%] rounded-[20px] rounded-bl-md border border-white/8 bg-white/[0.045] px-3.5 py-3 text-sm leading-relaxed text-white/80"
                          }
                        >
                          <div className="whitespace-pre-wrap break-words">
                            {message.text}
                          </div>

                          {message.role ===
                            "assistant" &&
                            message.action && (
                              <AiActionCard
                                action={message.action}
                                status={message.actionStatus}
                                result={message.actionResult}
                                executing={
                                  executingActionId ===
                                  message.id
                                }
                                onConfirm={() =>
                                  executeProposedAction(
                                    message
                                  )
                                }
                                onCancel={() =>
                                  cancelProposedAction(
                                    message
                                  )
                                }
                                isLightTheme={isLightTheme}
                              />
                            )}
                        </div>
                      )
                    )}

                    {sending && (
                      <div className={cn("flex max-w-[94%] items-center gap-2 rounded-[20px] rounded-bl-md border px-3.5 py-3 text-xs font-bold", isLightTheme ? "border-black/8 bg-white/85 text-black/50" : "border-white/8 bg-white/[0.045] text-white/45")}>
                        <SpinnerIcon className="h-4 w-4 animate-spin text-[#FFC61A]" />
                        Analizando datos del POS…
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className={cn("border-t px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4", isLightTheme ? "border-black/8 bg-[#F9F5EA]" : "border-white/8 bg-[#0A0E14]")}>
                {messages.length > 0 && (
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={clearConversation}
                      disabled={
                        sending ||
                        Boolean(
                          executingActionId
                        )
                      }
                      className={cn("text-[10px] font-bold transition disabled:opacity-30", isLightTheme ? "text-black/35 hover:text-black/65" : "text-white/30 hover:text-white/60")}
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
                    placeholder="Preguntá o pedí una tarea sobre tu negocio…"
                    className={cn("max-h-28 min-h-11 flex-1 resize-none rounded-2xl border px-3.5 py-3 text-sm outline-none transition focus:border-[#FFC61A]/45 disabled:opacity-55", isLightTheme ? "border-black/10 bg-white text-black placeholder:text-black/35" : "border-white/10 bg-white/[0.045] text-white placeholder:text-white/25")}
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

function AiActionCard({
  action,
  status,
  result,
  executing,
  onConfirm,
  onCancel,
  isLightTheme = false,
}) {
  const destructive =
    action?.destructiva ===
    true;

  const items =
    Array.isArray(
      action?.payload?.items
    )
      ? action.payload.items
      : [];

  const done =
    status === "success" ||
    status === "cancelled" ||
    status === "partial";

  const highImpact =
    action?.riesgo ===
    "alto";

  const financialDetails =
    (() => {
      const payload =
        action?.payload || {};

      if (
        action?.tipo ===
        "confirmar_compra"
      ) {
        return [
          payload.concepto
            ? `Compra: ${payload.concepto}`
            : null,
          Number.isFinite(Number(payload.costoReal))
            ? `Costo real: ${formatMoney(payload.costoReal)}`
            : null,
          payload.sumarStock
            ? `Stock: +${payload.cantidadStock} · ${payload.productoNombre || payload.productoBarcode || "producto"}`
            : "Sin ingreso automático a stock",
          payload.generarCuentaPorPagar
            ? "Generará cuenta por pagar"
            : "Sin cuenta por pagar",
        ].filter(Boolean);
      }

      if (
        action?.tipo ===
        "crear_cuenta_por_pagar"
      ) {
        const cuenta =
          payload.cuenta || {};
        return [
          cuenta.proveedorNombre
            ? `Proveedor: ${cuenta.proveedorNombre}`
            : null,
          cuenta.concepto
            ? `Concepto: ${cuenta.concepto}`
            : null,
          Number.isFinite(Number(cuenta.importeOriginal))
            ? `Importe: ${formatMoney(cuenta.importeOriginal)}`
            : null,
          cuenta.vencimiento
            ? `Vence: ${cuenta.vencimiento}`
            : null,
        ].filter(Boolean);
      }

      if (
        action?.tipo ===
        "crear_cuenta_por_cobrar"
      ) {
        const cuenta =
          payload.cuenta || {};
        return [
          cuenta.clienteNombre
            ? `Cliente: ${cuenta.clienteNombre}`
            : null,
          cuenta.concepto
            ? `Concepto: ${cuenta.concepto}`
            : null,
          Number.isFinite(Number(cuenta.importeOriginal))
            ? `Importe: ${formatMoney(cuenta.importeOriginal)}`
            : null,
          cuenta.vencimiento
            ? `Vence: ${cuenta.vencimiento}`
            : null,
        ].filter(Boolean);
      }

      if (
        action?.tipo ===
          "registrar_pago_cuenta_por_pagar" ||
        action?.tipo ===
          "registrar_pago_cuenta_por_cobrar"
      ) {
        return [
          payload.proveedorNombre
            ? `Proveedor: ${payload.proveedorNombre}`
            : payload.clienteNombre
              ? `Cliente: ${payload.clienteNombre}`
              : null,
          Number.isFinite(Number(payload.importe))
            ? `Movimiento: ${formatMoney(payload.importe)}`
            : null,
          payload.metodoPago
            ? `Medio: ${payload.metodoPago}`
            : null,
          Number.isFinite(Number(payload.saldoResultante))
            ? `Saldo después: ${formatMoney(payload.saldoResultante)}`
            : null,
          Number(payload.vuelto) > 0
            ? `Vuelto: ${formatMoney(payload.vuelto)}`
            : null,
        ].filter(Boolean);
      }

      return [];
    })();

  return (
    <div
      className={
        destructive
          ? isLightTheme
            ? "mt-3 rounded-2xl border border-red-300/60 bg-red-50 p-3"
            : "mt-3 rounded-2xl border border-red-400/25 bg-red-500/[0.07] p-3"
          : isLightTheme
            ? "mt-3 rounded-2xl border border-[#D6C28B] bg-[#FFF9E7] p-3"
            : "mt-3 rounded-2xl border border-[#FFC61A]/20 bg-[#FFC61A]/[0.045] p-3"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] font-black uppercase tracking-[0.14em]", isLightTheme ? "text-black/40" : "text-white/35")}>
            Acción propuesta
          </p>
          <p className={cn("mt-1 text-xs font-black", isLightTheme ? "text-[#151922]" : "text-white/90")}>
            {action?.titulo ||
              "Acción"}
          </p>
        </div>
        <span
          className={
            destructive
              ? isLightTheme
                ? "rounded-full bg-red-100 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-red-700"
                : "rounded-full bg-red-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-red-200"
              : isLightTheme
                ? "rounded-full bg-[#FFF0B3] px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-[#8C6A00]"
                : "rounded-full bg-[#FFC61A]/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-[#FFD65B]"
          }
        >
          {destructive
            ? "Alto riesgo"
            : highImpact
              ? "Alto impacto"
              : "Requiere confirmar"}
        </span>
      </div>

      <p className={cn("mt-2 text-[11px] leading-relaxed", isLightTheme ? "text-black/55" : "text-white/55")}>
        {action?.descripcion}
      </p>

      {action?.tipo ===
        "sumar_stock" && (
          <div className={cn("mt-2 rounded-xl px-3 py-2 text-[11px]", isLightTheme ? "bg-black/[0.045] text-black/60" : "bg-black/20 text-white/55")}>
            Stock: {action?.payload?.stockActual ?? "—"} → {action?.payload?.stockResultante ?? "—"} {action?.payload?.unidad || ""}
          </div>
        )}

      {financialDetails.length > 0 && (
        <div className={cn("mt-2 space-y-1 rounded-xl px-3 py-2", isLightTheme ? "bg-black/[0.045]" : "bg-black/20")}>
          {financialDetails.map(
            (detail) => (
              <p
                key={detail}
                className={cn("text-[11px]", isLightTheme ? "text-black/60" : "text-white/55")}
              >
                {detail}
              </p>
            )
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className={cn("mt-2 space-y-1 rounded-xl px-3 py-2", isLightTheme ? "bg-black/[0.045]" : "bg-black/20")}>
          {items.map(
            (item, index) => (
              <p
                key={`${item?.concepto || "item"}-${index}`}
                className={cn("text-[11px]", isLightTheme ? "text-black/60" : "text-white/55")}
              >
                {item?.cantidad || 1} × {item?.concepto || "Ítem"}
                {item?.proveedor
                  ? ` · ${item.proveedor}`
                  : ""}
              </p>
            )
          )}
        </div>
      )}

      {result && (
        <div
          className={
            status === "success"
              ? isLightTheme
                ? "mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700"
                : "mt-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.07] px-3 py-2 text-[11px] font-semibold text-emerald-100"
              : status === "cancelled"
                ? isLightTheme
                  ? "mt-2 rounded-xl border border-black/8 bg-black/[0.035] px-3 py-2 text-[11px] font-semibold text-black/50"
                  : "mt-2 rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold text-white/45"
                : isLightTheme
                  ? "mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700"
                  : "mt-2 rounded-xl border border-red-400/15 bg-red-400/[0.06] px-3 py-2 text-[11px] font-semibold text-red-100"
          }
        >
          {result}
        </div>
      )}

      {!done &&
        status !== "error" && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={executing}
              className={cn("flex-1 rounded-xl border px-3 py-2 text-[11px] font-black transition disabled:opacity-40", isLightTheme ? "border-black/10 bg-black/[0.035] text-black/60 hover:bg-black/[0.06]" : "border-white/10 bg-white/[0.035] text-white/55 hover:bg-white/[0.06]")}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={executing}
              className={
                destructive
                  ? cn("flex-1 rounded-xl px-3 py-2 text-[11px] font-black transition active:scale-[0.98] disabled:opacity-45", isLightTheme ? "bg-red-600 text-white hover:bg-red-500" : "bg-red-500 text-white hover:bg-red-400")
                  : cn("flex-1 rounded-xl bg-[#FFC61A] px-3 py-2 text-[11px] font-black text-black transition hover:bg-[#FFD248] active:scale-[0.98] disabled:opacity-45", isLightTheme ? "shadow-[0_8px_18px_rgba(255,198,26,0.12)]" : "")
              }
            >
              {executing
                ? "Aplicando…"
                : destructive
                  ? "Eliminar definitivamente"
                  : "Confirmar"}
            </button>
          </div>
        )}
    </div>
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
