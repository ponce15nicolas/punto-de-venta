// src/pages/Arca.jsx
// Onboarding fiscal ARCA — Etapa 1.
// Configura un sandbox interno del POS. No emite comprobantes ni conecta a producción.

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  httpsCallable,
} from "firebase/functions";

import {
  functions,
} from "../firebase/config";

const fnObtenerConfiguracionArca =
  httpsCallable(
    functions,
    "obtenerConfiguracionArca"
  );

const fnGuardarConfiguracionArca =
  httpsCallable(
    functions,
    "guardarConfiguracionArca"
  );

const CONDITION_OPTIONS = [
  {
    value: "",
    label: "Seleccionar condición",
  },
  {
    value: "monotributo",
    label: "Monotributo",
  },
  {
    value: "monotributo_social",
    label: "Monotributo social",
  },
  {
    value: "responsable_inscripto",
    label: "Responsable inscripto",
  },
  {
    value: "exento",
    label: "Exento",
  },
];

const EMPTY_FORM = {
  cuit: "",
  razonSocial: "",
  condicionFiscal: "",
  domicilioFiscal: "",
  puntoVenta: "",
};

function mensajeError(
  error,
  fallback
) {
  const raw =
    error?.message ||
    fallback;

  return String(raw)
    .replace(
      /^FirebaseError:\s*/i,
      ""
    )
    .replace(
      /^functions\/[a-z-]+:\s*/i,
      ""
    )
    .trim();
}

function formatCuitInput(
  value
) {
  const digits =
    String(value || "")
      .replace(/\D/g, "")
      .slice(0, 11);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 10) {
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function statusMeta(
  status
) {
  if (
    status ===
    "sandbox-operativo"
  ) {
    return {
      label: "Sandbox operativo",
      badge:
        "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
      dot:
        "bg-emerald-400",
    };
  }

  if (
    status ===
    "configurando"
  ) {
    return {
      label: "Configurando",
      badge:
        "border-[#FFC61A]/20 bg-[#FFC61A]/10 text-[#FFC61A]",
      dot:
        "bg-[#FFC61A]",
    };
  }

  return {
    label: "No configurado",
    badge:
      "border-white/10 bg-white/[0.04] text-white/55",
    dot:
      "bg-white/30",
  };
}

export default function Arca({
  license,
  operadorSesion,
}) {
  const [form, setForm] =
    useState(EMPTY_FORM);

  const [config, setConfig] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState(null);

  const [success, setSuccess] =
    useState(null);

  const requestContext =
    useMemo(
      () => ({
        clienteId:
          license?.clienteId,
        deviceId:
          license?.deviceId,
        sessionId:
          license?.sessionId,
        operadorSesion,
      }),
      [
        license?.clienteId,
        license?.deviceId,
        license?.sessionId,
        operadorSesion,
      ]
    );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response =
          await fnObtenerConfiguracionArca(
            requestContext
          );

        if (cancelled) {
          return;
        }

        const next =
          response?.data
            ?.config || {};

        setConfig(next);
        setForm({
          cuit:
            next.cuitFormato ||
            next.cuit ||
            "",
          razonSocial:
            next.razonSocial ||
            "",
          condicionFiscal:
            next.condicionFiscal ||
            "",
          domicilioFiscal:
            next.domicilioFiscal ||
            "",
          puntoVenta:
            next.puntoVenta == null
              ? ""
              : String(
                  next.puntoVenta
                ),
        });
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.error(
          "Error cargando configuración ARCA:",
          err
        );

        setError(
          mensajeError(
            err,
            "No se pudo cargar la configuración ARCA."
          )
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [requestContext]);

  const status =
    statusMeta(
      config?.status
    );

  const completed =
    Number(
      config
        ?.completed || 0
    );

  const total =
    Math.max(
      1,
      Number(
        config?.total || 5
      )
    );

  const progress =
    Math.min(
      100,
      Math.max(
        0,
        Math.round(
          (completed /
            total) *
            100
        )
      )
    );

  const requirements =
    config?.requirements || {};

  function setField(
    field,
    value
  ) {
    setSuccess(null);
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function save() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response =
        await fnGuardarConfiguracionArca({
          ...requestContext,
          environment:
            "sandbox",
          cuit:
            form.cuit,
          razonSocial:
            form.razonSocial,
          condicionFiscal:
            form.condicionFiscal,
          domicilioFiscal:
            form.domicilioFiscal,
          puntoVenta:
            form.puntoVenta,
        });

      const next =
        response?.data
          ?.config || null;

      setConfig(next);

      if (
        next?.status ===
        "sandbox-operativo"
      ) {
        setSuccess(
          "Configuración completa. El sandbox quedó operativo para la próxima etapa."
        );
      } else {
        setSuccess(
          "Progreso guardado. Podés completar los requisitos restantes cuando quieras."
        );
      }
    } catch (err) {
      console.error(
        "Error guardando configuración ARCA:",
        err
      );

      setError(
        mensajeError(
          err,
          "No se pudo guardar la configuración ARCA."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-36 animate-pulse rounded-[26px] border border-white/10 bg-white/[0.035]" />
        <div className="h-64 animate-pulse rounded-[26px] border border-white/10 bg-white/[0.035]" />
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-3">
      <section className="overflow-hidden rounded-[26px] border border-[#FFC61A]/15 bg-[#11151C] p-4 text-white shadow-[0_18px_50px_rgba(0,0,0,0.16)] sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFC61A] text-black shadow-[0_10px_28px_rgba(255,198,26,0.16)]">
            <ReceiptIcon className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.17em] text-[#FFC61A]">
              Facturación ARCA
            </p>
            <h2 className="mt-1 text-base font-black">
              Configuración fiscal
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Etapa inicial de configuración. Este módulo todavía no emite comprobantes reales, CAE ni se conecta a producción.
            </p>
          </div>

          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.08em] ${status.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>

        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.035] p-3">
          <div className="flex items-center justify-between gap-3 text-[10px] font-bold text-white/50">
            <span>
              Requisitos completos
            </span>
            <span className="font-black text-white/80">
              {completed} / {total}
            </span>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[#FFC61A] transition-[width] duration-300"
              style={{
                width: `${progress}%`,
              }}
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-[20px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-200">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-[20px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-xs font-semibold text-emerald-300">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <section className="rounded-[26px] border border-white/10 bg-[#11151C] p-4 text-white sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[#FFC61A]">
              Onboarding
            </p>
            <h3 className="mt-1 text-sm font-black">
              Datos del contribuyente
            </h3>
          </div>

          <span className="rounded-full border border-[#FFC61A]/20 bg-[#FFC61A]/10 px-2.5 py-1.5 text-[9px] font-black uppercase text-[#FFC61A]">
            Sandbox
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          <FieldCard
            complete={
              requirements.cuit
            }
            label="CUIT"
            helper="Se valida el dígito verificador antes de guardar."
          >
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={form.cuit}
              onChange={(event) =>
                setField(
                  "cuit",
                  formatCuitInput(
                    event.target.value
                  )
                )
              }
              placeholder="20-12345678-3"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-bold text-white outline-none transition placeholder:text-white/25 focus:border-[#FFC61A]/50"
            />
          </FieldCard>

          <FieldCard
            complete={
              requirements.razonSocial
            }
            label="Razón social"
            helper="Nombre fiscal del contribuyente."
          >
            <input
              type="text"
              value={form.razonSocial}
              onChange={(event) =>
                setField(
                  "razonSocial",
                  event.target.value.slice(
                    0,
                    120
                  )
                )
              }
              placeholder="Ej. Comercio Demo"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-bold text-white outline-none transition placeholder:text-white/25 focus:border-[#FFC61A]/50"
            />
          </FieldCard>

          <FieldCard
            complete={
              requirements.condicionFiscal
            }
            label="Condición fiscal"
            helper="Esta lista se ampliará si el flujo real de ARCA lo requiere."
          >
            <select
              value={form.condicionFiscal}
              onChange={(event) =>
                setField(
                  "condicionFiscal",
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-bold text-white outline-none transition focus:border-[#FFC61A]/50"
            >
              {CONDITION_OPTIONS.map(
                (option) => (
                  <option
                    key={
                      option.value ||
                      "empty"
                    }
                    value={option.value}
                  >
                    {option.label}
                  </option>
                )
              )}
            </select>
          </FieldCard>

          <FieldCard
            complete={
              requirements.domicilioFiscal
            }
            label="Domicilio fiscal"
            helper="Dirección fiscal que luego usaremos en el comprobante."
          >
            <input
              type="text"
              value={form.domicilioFiscal}
              onChange={(event) =>
                setField(
                  "domicilioFiscal",
                  event.target.value.slice(
                    0,
                    220
                  )
                )
              }
              placeholder="Calle, número, localidad y provincia"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-bold text-white outline-none transition placeholder:text-white/25 focus:border-[#FFC61A]/50"
            />
          </FieldCard>

          <FieldCard
            complete={
              requirements.puntoVenta
            }
            label="Punto de venta"
            helper="En esta etapa se usa únicamente como dato de prueba. Producción permanece bloqueada."
          >
            <input
              type="number"
              min="1"
              max="99999"
              step="1"
              value={form.puntoVenta}
              onChange={(event) =>
                setField(
                  "puntoVenta",
                  event.target.value
                )
              }
              placeholder="Ej. 4"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-bold text-white outline-none transition placeholder:text-white/25 focus:border-[#FFC61A]/50"
            />
          </FieldCard>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-black text-black transition hover:bg-[#FFD248] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <SaveIcon className="h-4 w-4" />
          )}
          {saving
            ? "Guardando…"
            : "Guardar configuración"}
        </button>
      </section>

      <section className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 text-white">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/55">
            <LockIcon className="h-[18px] w-[18px]" />
          </div>

          <div>
            <p className="text-xs font-black">
              Producción ARCA bloqueada
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/45">
              Ningún dato de esta pantalla puede habilitar facturación real. Certificados, WSAA, WSFEv1, CAE y emisión fiscal se incorporarán en etapas posteriores con validación backend.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function FieldCard({
  complete,
  label,
  helper,
  children,
}) {
  return (
    <label className="block rounded-[20px] border border-white/10 bg-white/[0.035] p-3.5">
      <span className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-xs font-black text-white/80">
            {label}
          </span>
          <span className="mt-1 block text-[10px] leading-relaxed text-white/35">
            {helper}
          </span>
        </span>

        <span
          className={
            complete
              ? "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-emerald-300"
              : "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/5 text-white/25"
          }
          aria-label={
            complete
              ? "Requisito completo"
              : "Requisito pendiente"
          }
        >
          {complete ? (
            <CheckIcon className="h-3.5 w-3.5" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          )}
        </span>
      </span>

      {children}
    </label>
  );
}

function ReceiptIcon({
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
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h3" />
    </svg>
  );
}

function AlertIcon({
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
      <path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function CheckIcon({
  className = "",
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function SaveIcon({
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
      <path d="M5 3h12l2 2v16H5V3Z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 15h8" />
    </svg>
  );
}

function LockIcon({
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
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
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
