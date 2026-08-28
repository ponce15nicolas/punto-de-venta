// src/pages/CuentasPorCobrar.jsx
//
// Gestión de cuentas por cobrar del POS.
// Etapa 1: consulta + alta manual de deudas anteriores o externas al POS.

import {
  useMemo,
  useState,
} from "react";

import { motion } from "motion/react";

import { money } from "../lib/format";
import Modal from "../components/Modal";

/* =========================================================
   HELPERS
========================================================= */

function toNumber(
  value,
  fallback = 0
) {
  const normalized =
    typeof value === "string"
      ? value.replace(",", ".")
      : value;

  const number =
    Number(normalized);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function roundMoney(value) {
  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * 100
    ) / 100
  );
}

function todayDateOnly() {
  const now = new Date();

  const offset =
    now.getTimezoneOffset() *
    60 * 1000;

  return new Date(
    now.getTime() - offset
  )
    .toISOString()
    .slice(0, 10);
}

function formatDateOnly(value) {
  const clean =
    String(value || "")
      .trim();

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      clean
    );

  if (!match) {
    return "Sin fecha";
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es-AR");
}

function isSettled(account) {
  return (
    account?.estado === "pagado" ||
    roundMoney(
      account?.saldoPendiente
    ) <= 0
  );
}

function isOverdue(account) {
  if (
    isSettled(account) ||
    !account?.vencimiento
  ) {
    return false;
  }

  return (
    String(account.vencimiento) <
    todayDateOnly()
  );
}

function getStatusMeta(account) {
  if (isSettled(account)) {
    return {
      label: "Pagada",
      className:
        "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (isOverdue(account)) {
    return {
      label: "Vencida",
      className:
        "border-red-400/20 bg-red-500/10 text-red-300",
    };
  }

  if (
    account?.estado ===
    "parcial"
  ) {
    return {
      label: "Parcial",
      className:
        "border-[#FFC61A]/20 bg-[#FFC61A]/10 text-[#FFC61A]",
    };
  }

  return {
    label: "Pendiente",
    className:
      "border-white/10 bg-white/5 text-white/55",
  };
}

function getSummary(accounts) {
  const safeAccounts =
    Array.isArray(accounts)
      ? accounts
      : [];

  const outstanding =
    safeAccounts.filter(
      (account) =>
        !isSettled(account)
    );

  const totalPending =
    roundMoney(
      outstanding.reduce(
        (
          total,
          account
        ) =>
          total +
          roundMoney(
            account
              ?.saldoPendiente
          ),
        0
      )
    );

  const customers =
    new Set(
      outstanding
        .map(
          (account) =>
            normalizeSearch(
              account
                ?.clienteNombre
            )
        )
        .filter(Boolean)
    ).size;

  const overdue =
    outstanding.filter(
      isOverdue
    ).length;

  const paid =
    safeAccounts.filter(
      isSettled
    ).length;

  return {
    totalPending,
    customers,
    overdue,
    paid,
  };
}

const PAYMENT_METHODS = [
  {
    id: "efectivo",
    label: "Efectivo",
  },
  {
    id: "transferencia",
    label: "Transferencia",
  },
  {
    id: "qr",
    label: "QR",
  },
  {
    id: "tarjeta",
    label: "Tarjeta",
  },
];

function formatPaymentDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  ).format(date);
}

const FILTERS = [
  {
    id: "pendientes",
    label: "Pendientes",
  },
  {
    id: "vencidas",
    label: "Vencidas",
  },
  {
    id: "parciales",
    label: "Parciales",
  },
  {
    id: "pagadas",
    label: "Pagadas",
  },
  {
    id: "todas",
    label: "Todas",
  },
];

/* =========================================================
   COMPONENTE
========================================================= */

export default function CuentasPorCobrar({
  pos,
  onBack,
}) {
  const accounts =
    Array.isArray(
      pos?.accountsReceivable
    )
      ? pos.accountsReceivable
      : [];

  const summary =
    useMemo(
      () => getSummary(accounts),
      [accounts]
    );

  const [filter, setFilter] =
    useState("pendientes");

  const [search, setSearch] =
    useState("");

  const [createOpen, setCreateOpen] =
    useState(false);

  const [selected, setSelected] =
    useState(null);

  const [detailMode, setDetailMode] =
    useState("detail");

  const selectedAccount =
    useMemo(() => {
      if (!selected?.id) {
        return null;
      }

      return (
        accounts.find(
          (account) =>
            account?.id ===
            selected.id
        ) ||
        selected
      );
    }, [
      accounts,
      selected,
    ]);

  const filtered =
    useMemo(() => {
      const term =
        normalizeSearch(search);

      return accounts.filter(
        (account) => {
          const matchesSearch =
            !term ||
            [
              account?.clienteNombre,
              account?.clienteTelefono,
              account?.concepto,
              account?.notas,
            ].some(
              (value) =>
                normalizeSearch(
                  value
                ).includes(
                  term
                )
            );

          if (!matchesSearch) {
            return false;
          }

          if (
            filter === "todas"
          ) {
            return true;
          }

          if (
            filter === "pagadas"
          ) {
            return isSettled(
              account
            );
          }

          if (
            filter === "vencidas"
          ) {
            return isOverdue(
              account
            );
          }

          if (
            filter === "parciales"
          ) {
            return (
              !isSettled(account) &&
              account?.estado ===
                "parcial"
            );
          }

          return !isSettled(
            account
          );
        }
      );
    }, [
      accounts,
      filter,
      search,
    ]);

  return (
    <div className="pb-3">
      {/* =====================================================
          CABECERA
      ===================================================== */}

      <section
        className="
          overflow-hidden
          rounded-[28px]
          bg-white
          text-[#111318]
          shadow-[0_18px_50px_rgba(0,0,0,0.18)]
        "
      >
        <div className="p-4 sm:p-5">
          <button
            type="button"
            onClick={onBack}
            className="
              inline-flex
              items-center
              gap-1.5
              rounded-xl
              bg-[#F4F5F7]
              px-3
              py-2.5
              text-xs
              font-extrabold
              text-black/55
              transition
              hover:bg-[#ECEEF1]
              active:scale-[0.98]
            "
          >
            <BackIcon className="h-4 w-4" />
            Volver a Caja
          </button>

          <div
            className="
              mt-4
              flex
              items-start
              justify-between
              gap-3
            "
          >
            <div className="min-w-0">
              <p
                className="
                  text-[10px]
                  font-extrabold
                  uppercase
                  tracking-[0.16em]
                  text-[#B98700]
                "
              >
                Gestión de cobros
              </p>

              <h2
                className="
                  mt-1
                  text-xl
                  font-black
                  tracking-[-0.02em]
                  text-[#111318]
                "
              >
                Cuentas por cobrar
              </h2>

              <p
                className="
                  mt-1
                  max-w-[320px]
                  text-sm
                  leading-relaxed
                  text-black/45
                "
              >
                Registrá y controlá saldos pendientes de tus clientes.
              </p>
            </div>

            <div
              className="
                grid
                h-11
                w-11
                shrink-0
                place-items-center
                rounded-2xl
                bg-[#FFF5CC]
                text-[#9A7100]
              "
            >
              <WalletIcon className="h-5 w-5" />
            </div>
          </div>

          <div
            className="
              my-5
              h-[3px]
              rounded-full
              bg-[#FFC61A]
            "
          />

          <div className="grid grid-cols-3 gap-2.5">
            <SummaryStat
              label="Pendiente"
              value={money(
                summary.totalPending
              )}
              highlight
            />

            <SummaryStat
              label="Clientes"
              value={summary.customers}
            />

            <SummaryStat
              label="Vencidas"
              value={summary.overdue}
              danger={
                summary.overdue > 0
              }
            />
          </div>
        </div>
      </section>

      {/* =====================================================
          ALTA MANUAL
      ===================================================== */}

      <button
        type="button"
        onClick={() =>
          setCreateOpen(true)
        }
        className="
          mt-4
          inline-flex
          w-full
          items-center
          justify-center
          gap-2
          rounded-2xl
          bg-[#FFC61A]
          px-4
          py-3.5
          text-sm
          font-extrabold
          text-black
          shadow-[0_12px_30px_rgba(255,198,26,0.16)]
          transition
          hover:bg-[#FFD248]
          active:scale-[0.99]
        "
      >
        <PlusIcon className="h-4 w-4" />
        Nueva deuda
      </button>

      <p
        className="
          mt-2
          px-1
          text-[11px]
          leading-relaxed
          text-white/35
        "
      >
        También podés cargar deudas anteriores a la implementación de este punto de venta.
      </p>

      {/* =====================================================
          BÚSQUEDA
      ===================================================== */}

      <div className="relative mt-5">
        <SearchIcon
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
          type="search"
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value
            )
          }
          placeholder="Buscar cliente, teléfono o concepto"
          className="
            w-full
            rounded-2xl
            border
            border-white/10
            bg-[#151A22]
            py-3.5
            pl-10
            pr-4
            text-sm
            font-semibold
            text-white
            outline-none
            transition
            placeholder:text-white/25
            focus:border-[#FFC61A]/40
            focus:ring-2
            focus:ring-[#FFC61A]/10
          "
        />
      </div>

      {/* =====================================================
          FILTROS
      ===================================================== */}

      <div
        className="
          mt-3
          flex
          gap-2
          overflow-x-auto
          pb-1
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {FILTERS.map(
          (item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                setFilter(item.id)
              }
              className={
                `
                  shrink-0
                  rounded-full
                  border
                  px-3
                  py-2
                  text-[10px]
                  font-extrabold
                  transition
                ` +
                (
                  filter === item.id
                    ? " border-[#FFC61A]/30 bg-[#FFC61A]/10 text-[#FFC61A]"
                    : " border-white/10 bg-white/5 text-white/40 hover:bg-white/10"
                )
              }
            >
              {item.label}
            </button>
          )
        )}
      </div>

      {/* =====================================================
          LISTADO
      ===================================================== */}

      <div
        className="
          mb-3
          mt-5
          flex
          items-end
          justify-between
          gap-3
        "
      >
        <div>
          <p
            className="
              text-[10px]
              font-extrabold
              uppercase
              tracking-[0.16em]
              text-[#FFC61A]
            "
          >
            Cartera
          </p>

          <h3
            className="
              mt-1
              text-lg
              font-black
              text-white
            "
          >
            {FILTERS.find(
              (item) =>
                item.id === filter
            )?.label ||
              "Cuentas"}
          </h3>
        </div>

        <span
          className="
            shrink-0
            rounded-full
            border
            border-white/10
            bg-white/5
            px-2.5
            py-1.5
            text-[10px]
            font-bold
            text-white/45
          "
        >
          {filtered.length}{" "}
          {filtered.length === 1
            ? "cuenta"
            : "cuentas"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          hasAccounts={
            accounts.length > 0
          }
          onCreate={() =>
            setCreateOpen(true)
          }
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map(
            (
              account,
              index
            ) => (
              <AccountCard
                key={account.id}
                account={account}
                index={index}
                onClick={() => {
                  setDetailMode(
                    "detail"
                  );
                  setSelected(
                    account
                  );
                }}
              />
            )
          )}
        </div>
      )}

      {/* =====================================================
          MODAL NUEVA DEUDA
      ===================================================== */}

      <Modal
        open={createOpen}
        onClose={() =>
          setCreateOpen(false)
        }
        title="Nueva deuda"
      >
        <CreateDebtForm
          pos={pos}
          onCancel={() =>
            setCreateOpen(false)
          }
          onCreated={() => {
            setCreateOpen(false);
            setFilter(
              "pendientes"
            );
          }}
        />
      </Modal>

      {/* =====================================================
          MODAL DETALLE
      ===================================================== */}

      <Modal
        open={Boolean(
          selectedAccount
        )}
        onClose={() => {
          setSelected(null);
          setDetailMode(
            "detail"
          );
        }}
        title={
          detailMode ===
          "payment"
            ? "Registrar pago"
            : "Detalle de cuenta"
        }
      >
        {selectedAccount &&
          detailMode ===
            "detail" && (
          <AccountDetail
            account={
              selectedAccount
            }
            hasOpenCash={
              Boolean(
                pos?.openSession
              )
            }
            onPay={() =>
              setDetailMode(
                "payment"
              )
            }
          />
        )}

        {selectedAccount &&
          detailMode ===
            "payment" && (
          <RegisterPaymentForm
            pos={pos}
            account={
              selectedAccount
            }
            onCancel={() =>
              setDetailMode(
                "detail"
              )
            }
            onPaid={() =>
              setDetailMode(
                "detail"
              )
            }
          />
        )}
      </Modal>
    </div>
  );
}

/* =========================================================
   ACCESO / RESUMEN EXPORTABLE PARA CAJA
========================================================= */

export function getAccountsReceivableSummary(
  accounts
) {
  return getSummary(accounts);
}

/* =========================================================
   FORMULARIO NUEVA DEUDA
========================================================= */

function CreateDebtForm({
  pos,
  onCancel,
  onCreated,
}) {
  const [saving, setSaving] =
    useState(false);

  const [form, setForm] =
    useState(() => ({
      clienteNombre: "",
      clienteTelefono: "",
      concepto: "",
      importeOriginal: "",
      fechaOrigen:
        todayDateOnly(),
      vencimiento: "",
      notas: "",
    }));

  const amount =
    roundMoney(
      toNumber(
        form.importeOriginal,
        NaN
      )
    );

  const valid =
    Boolean(
      form.clienteNombre.trim() &&
      form.concepto.trim() &&
      form.fechaOrigen &&
      Number.isFinite(amount) &&
      amount > 0 &&
      (
        !form.vencimiento ||
        form.vencimiento >=
          form.fechaOrigen
      )
    );

  function setField(
    field,
    value
  ) {
    setForm(
      (previous) => ({
        ...previous,
        [field]: value,
      })
    );
  }

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (
      !valid ||
      saving
    ) {
      return;
    }

    if (
      typeof pos
        ?.createManualReceivable !==
      "function"
    ) {
      pos?.showToast?.(
        "La gestión de cuentas por cobrar no está disponible",
        true
      );

      return;
    }

    setSaving(true);

    try {
      const ok =
        await pos
          .createManualReceivable({
            ...form,
            importeOriginal:
              amount,
          });

      if (ok) {
        onCreated?.();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
    >
      <div
        className="
          mb-4
          rounded-[20px]
          border
          border-[#FFC61A]/15
          bg-[#FFC61A]/[0.06]
          p-3.5
        "
      >
        <div className="flex items-start gap-3">
          <div
            className="
              grid
              h-9
              w-9
              shrink-0
              place-items-center
              rounded-xl
              bg-[#FFC61A]/10
              text-[#FFC61A]
            "
          >
            <HistoryIcon className="h-4 w-4" />
          </div>

          <div>
            <p
              className="
                text-sm
                font-extrabold
                text-white
              "
            >
              Alta manual
            </p>

            <p
              className="
                mt-1
                text-xs
                leading-relaxed
                text-white/40
              "
            >
              La deuda puede tener una fecha anterior al POS y no modifica ninguna caja histórica.
            </p>
          </div>
        </div>
      </div>

      <FormField
        label="Cliente"
        required
      >
        <input
          type="text"
          value={form.clienteNombre}
          maxLength={120}
          autoComplete="off"
          placeholder="Ej. Juan Pérez"
          onChange={(event) =>
            setField(
              "clienteNombre",
              event.target.value
            )
          }
          className={inputClassName}
        />
      </FormField>

      <FormField label="Teléfono">
        <input
          type="tel"
          value={form.clienteTelefono}
          maxLength={50}
          autoComplete="off"
          placeholder="Opcional"
          onChange={(event) =>
            setField(
              "clienteTelefono",
              event.target.value
            )
          }
          className={inputClassName}
        />
      </FormField>

      <FormField
        label="Concepto"
        required
      >
        <input
          type="text"
          value={form.concepto}
          maxLength={180}
          autoComplete="off"
          placeholder="Ej. Mercadería anterior"
          onChange={(event) =>
            setField(
              "concepto",
              event.target.value
            )
          }
          className={inputClassName}
        />
      </FormField>

      <FormField
        label="Importe original"
        required
      >
        <div className="relative">
          <span
            className="
              pointer-events-none
              absolute
              left-4
              top-1/2
              -translate-y-1/2
              text-base
              font-black
              text-[#FFC61A]
            "
          >
            $
          </span>

          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={form.importeOriginal}
            placeholder="0.00"
            onChange={(event) =>
              setField(
                "importeOriginal",
                event.target.value
              )
            }
            className={`${inputClassName} pl-9`}
          />
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-2.5">
        <FormField
          label="Fecha de origen"
          required
        >
          <input
            type="date"
            value={form.fechaOrigen}
            onChange={(event) =>
              setField(
                "fechaOrigen",
                event.target.value
              )
            }
            className={inputClassName}
          />
        </FormField>

        <FormField label="Vencimiento">
          <input
            type="date"
            min={
              form.fechaOrigen ||
              undefined
            }
            value={form.vencimiento}
            onChange={(event) =>
              setField(
                "vencimiento",
                event.target.value
              )
            }
            className={inputClassName}
          />
        </FormField>
      </div>

      <FormField label="Notas">
        <textarea
          rows="3"
          value={form.notas}
          maxLength={1000}
          placeholder="Información adicional, detalle de productos, acuerdo de pago, etc."
          onChange={(event) =>
            setField(
              "notas",
              event.target.value
            )
          }
          className={`${inputClassName} resize-none`}
        />
      </FormField>

      {form.vencimiento &&
        form.fechaOrigen &&
        form.vencimiento <
          form.fechaOrigen && (
          <p
            className="
              mb-3
              rounded-xl
              border
              border-red-400/20
              bg-red-500/10
              px-3
              py-2.5
              text-xs
              font-semibold
              text-red-200
            "
          >
            El vencimiento no puede ser anterior a la fecha de origen.
          </p>
        )}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="
            rounded-2xl
            border
            border-white/10
            bg-white/5
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-white/65
            transition
            hover:bg-white/10
            disabled:opacity-50
          "
        >
          Cancelar
        </button>

        <button
          type="submit"
          disabled={
            !valid ||
            saving
          }
          className="
            inline-flex
            items-center
            justify-center
            gap-2
            rounded-2xl
            bg-[#FFC61A]
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-black
            transition
            hover:bg-[#FFD248]
            active:scale-[0.99]
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          {saving ? (
            <LoadingIcon className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" />
          )}

          {saving
            ? "Guardando..."
            : "Registrar deuda"}
        </button>
      </div>
    </form>
  );
}

const inputClassName = `
  w-full
  rounded-2xl
  border
  border-white/10
  bg-[#171B23]
  px-4
  py-3.5
  text-sm
  font-semibold
  text-white
  outline-none
  transition
  placeholder:text-white/25
  focus:border-[#FFC61A]/40
  focus:ring-2
  focus:ring-[#FFC61A]/10
  disabled:opacity-50
`;

function FormField({
  label,
  required = false,
  children,
}) {
  return (
    <label className="mb-3 block">
      <span
        className="
          mb-1.5
          block
          text-xs
          font-bold
          text-white/55
        "
      >
        {label}
        {required && (
          <span className="text-[#FFC61A]">
            {" "}*
          </span>
        )}
      </span>

      {children}
    </label>
  );
}

/* =========================================================
   CARD
========================================================= */

function AccountCard({
  account,
  index,
  onClick,
}) {
  const status =
    getStatusMeta(account);

  return (
    <motion.button
      type="button"
      initial={{
        opacity: 0,
        y: 6,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      transition={{
        delay:
          Math.min(
            index * 0.025,
            0.15
          ),
      }}
      onClick={onClick}
      className="
        group
        w-full
        rounded-[22px]
        border
        border-white/10
        bg-[#151A22]
        p-3.5
        text-left
        shadow-[0_12px_30px_rgba(0,0,0,0.14)]
        transition
        hover:border-white/20
        hover:bg-[#1A2029]
        active:scale-[0.995]
      "
    >
      <div
        className="
          flex
          items-start
          justify-between
          gap-3
        "
      >
        <div className="min-w-0">
          <div
            className="
              flex
              min-w-0
              items-center
              gap-2
            "
          >
            <p
              className="
                truncate
                text-sm
                font-extrabold
                text-white
              "
            >
              {account
                ?.clienteNombre ||
                "Cliente"}
            </p>

            <span
              className={`
                shrink-0
                rounded-full
                border
                px-2
                py-1
                text-[8px]
                font-extrabold
                uppercase
                tracking-[0.08em]
                ${status.className}
              `}
            >
              {status.label}
            </span>
          </div>

          <p
            className="
              mt-1
              truncate
              text-[10px]
              font-semibold
              text-white/40
            "
          >
            {account?.concepto ||
              "Deuda"}
          </p>
        </div>

        <ChevronIcon
          className="
            mt-1
            h-4
            w-4
            shrink-0
            text-white/20
            transition
            group-hover:translate-x-0.5
            group-hover:text-[#FFC61A]
          "
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat
          label="Saldo pendiente"
          value={money(
            account
              ?.saldoPendiente
          )}
          highlight={
            !isSettled(account)
          }
        />

        <MiniStat
          label={
            account?.vencimiento
              ? "Vencimiento"
              : "Fecha origen"
          }
          value={formatDateOnly(
            account?.vencimiento ||
              account?.fechaOrigen
          )}
          danger={
            isOverdue(account)
          }
        />
      </div>
    </motion.button>
  );
}

/* =========================================================
   DETALLE
========================================================= */

function AccountDetail({
  account,
  hasOpenCash,
  onPay,
}) {
  const status =
    getStatusMeta(account);

  const payments =
    Array.isArray(
      account?.pagos
    )
      ? account.pagos
          .slice()
          .sort(
            (a, b) =>
              String(
                b?.fecha ||
                ""
              ).localeCompare(
                String(
                  a?.fecha ||
                  ""
                )
              )
          )
      : [];

  return (
    <div>
      <div
        className="
          overflow-hidden
          rounded-[22px]
          bg-white
          text-[#111318]
        "
      >
        <div className="p-4">
          <div
            className="
              flex
              items-start
              justify-between
              gap-3
            "
          >
            <div className="min-w-0">
              <p
                className="
                  text-[10px]
                  font-extrabold
                  uppercase
                  tracking-[0.16em]
                  text-[#B98700]
                "
              >
                {account?.origen ===
                "venta"
                  ? "Generada por venta"
                  : "Alta manual"}
              </p>

              <h3
                className="
                  mt-1
                  truncate
                  text-lg
                  font-black
                  text-[#111318]
                "
              >
                {account
                  ?.clienteNombre ||
                  "Cliente"}
              </h3>

              <p
                className="
                  mt-1
                  text-xs
                  font-semibold
                  text-black/40
                "
              >
                {account?.concepto ||
                  "Deuda"}
              </p>
            </div>

            <span
              className={`
                shrink-0
                rounded-full
                border
                px-2.5
                py-1.5
                text-[9px]
                font-extrabold
                ${status.className}
              `}
            >
              {status.label}
            </span>
          </div>

          <div
            className="
              mt-4
              h-[3px]
              rounded-full
              bg-[#FFC61A]
            "
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <DarkStat
          label="Importe original"
          value={money(
            account
              ?.importeOriginal
          )}
        />

        <DarkStat
          label="Saldo pendiente"
          value={money(
            account
              ?.saldoPendiente
          )}
          highlight
        />

        <DarkStat
          label="Pagado"
          value={money(
            account?.totalPagado
          )}
        />

        <DarkStat
          label="Fecha de origen"
          value={formatDateOnly(
            account?.fechaOrigen
          )}
        />
      </div>

      <DetailRow
        label="Vencimiento"
        value={
          account?.vencimiento
            ? formatDateOnly(
                account.vencimiento
              )
            : "Sin vencimiento"
        }
      />

      {account?.origen ===
        "venta" &&
        account?.ventaId && (
        <DetailRow
          label="Venta vinculada"
          value={`#${account.ventaId}`}
        />
      )}

      {account?.clienteTelefono && (
        <DetailRow
          label="Teléfono"
          value={
            account.clienteTelefono
          }
        />
      )}

      {account?.notas && (
        <div
          className="
            mt-3
            rounded-[20px]
            border
            border-white/10
            bg-white/5
            p-3.5
          "
        >
          <p
            className="
              text-[9px]
              font-extrabold
              uppercase
              tracking-[0.12em]
              text-white/35
            "
          >
            Notas
          </p>

          <p
            className="
              mt-1.5
              whitespace-pre-wrap
              text-xs
              leading-relaxed
              text-white/60
            "
          >
            {account.notas}
          </p>
        </div>
      )}

      {!isSettled(account) && (
        <div
          className="
            mt-4
            rounded-[20px]
            border
            border-[#FFC61A]/20
            bg-[#FFC61A]/[0.07]
            p-3.5
          "
        >
          <p
            className="
              text-sm
              font-extrabold
              text-white
            "
          >
            Registrar cobro
          </p>

          <p
            className="
              mt-1
              text-xs
              leading-relaxed
              text-white/40
            "
          >
            {hasOpenCash
              ? "Podés registrar un pago parcial o cancelar el saldo completo."
              : "Necesitás abrir una caja para registrar un cobro real."}
          </p>

          <button
            type="button"
            onClick={onPay}
            disabled={!hasOpenCash}
            className="
              mt-3
              inline-flex
              w-full
              items-center
              justify-center
              gap-2
              rounded-2xl
              bg-[#FFC61A]
              px-4
              py-3.5
              text-sm
              font-extrabold
              text-black
              transition
              hover:bg-[#FFD248]
              active:scale-[0.99]
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
          >
            Registrar pago
          </button>
        </div>
      )}

      <div className="mt-5">
        <div
          className="
            mb-2.5
            flex
            items-end
            justify-between
            gap-3
          "
        >
          <div>
            <p
              className="
                text-[9px]
                font-extrabold
                uppercase
                tracking-[0.14em]
                text-[#FFC61A]
              "
            >
              Cobros
            </p>

            <h4
              className="
                mt-1
                text-sm
                font-black
                text-white
              "
            >
              Historial de pagos
            </h4>
          </div>

          <span
            className="
              shrink-0
              rounded-full
              border
              border-white/10
              bg-white/5
              px-2.5
              py-1
              text-[9px]
              font-bold
              text-white/40
            "
          >
            {payments.length}
          </span>
        </div>

        {payments.length === 0 ? (
          <div
            className="
              rounded-[20px]
              border
              border-white/10
              bg-white/5
              px-4
              py-5
              text-center
            "
          >
            <p
              className="
                text-xs
                font-semibold
                text-white/35
              "
            >
              Todavía no hay pagos registrados para esta cuenta.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map(
              (payment) => (
                <PaymentHistoryRow
                  key={payment.id}
                  payment={payment}
                />
              )
            )}
          </div>
        )}
      </div>

      <div
        className="
          mt-4
          rounded-[20px]
          border
          border-white/10
          bg-white/5
          p-3.5
        "
      >
        <p
          className="
            text-[9px]
            font-extrabold
            uppercase
            tracking-[0.12em]
            text-white/35
          "
        >
          Registro
        </p>

        <p
          className="
            mt-1.5
            text-xs
            leading-relaxed
            text-white/45
          "
        >
          {account?.creadoPor
            ?.operadorNombre
            ? `Registrada por ${account.creadoPor.operadorNombre}.`
            : "Registrada en el sistema."}
          {" "}
          Cada cobro conserva importe, método, caja y operador.
        </p>
      </div>
    </div>
  );
}

function PaymentHistoryRow({
  payment,
}) {
  const method =
    PAYMENT_METHODS.find(
      (item) =>
        item.id ===
        payment?.metodoPago
    );

  return (
    <div
      className="
        rounded-[18px]
        border
        border-white/10
        bg-[#151A22]
        px-3.5
        py-3
      "
    >
      <div
        className="
          flex
          items-start
          justify-between
          gap-3
        "
      >
        <div className="min-w-0">
          <p
            className="
              text-xs
              font-extrabold
              text-white
            "
          >
            {method?.label ||
              "Cobro"}
          </p>

          <p
            className="
              mt-1
              text-[10px]
              font-semibold
              text-white/35
            "
          >
            {formatPaymentDate(
              payment?.fecha
            )}
          </p>

          {payment?.operador
            ?.operadorNombre && (
            <p
              className="
                mt-1
                truncate
                text-[10px]
                font-semibold
                text-white/30
              "
            >
              {payment.operador
                .operadorNombre}
            </p>
          )}
        </div>

        <span
          className="
            shrink-0
            text-sm
            font-black
            text-[#FFC61A]
          "
        >
          {money(
            payment?.importe
          )}
        </span>
      </div>
    </div>
  );
}

function RegisterPaymentForm({
  pos,
  account,
  onCancel,
  onPaid,
}) {
  const balance =
    roundMoney(
      account?.saldoPendiente
    );

  const [amount, setAmount] =
    useState(
      balance > 0
        ? String(balance)
        : ""
    );

  const [method, setMethod] =
    useState("efectivo");

  const [saving, setSaving] =
    useState(false);

  const tenderedAmount =
    roundMoney(
      toNumber(
        amount,
        NaN
      )
    );

  const paymentAmount =
    method === "efectivo"
      ? roundMoney(
          Math.min(
            Math.max(
              0,
              tenderedAmount
            ),
            balance
          )
        )
      : tenderedAmount;

  const changeAmount =
    method === "efectivo" &&
    Number.isFinite(
      tenderedAmount
    )
      ? roundMoney(
          Math.max(
            0,
            tenderedAmount -
              balance
          )
        )
      : 0;

  const valid =
    Boolean(
      pos?.openSession &&
      Number.isFinite(
        tenderedAmount
      ) &&
      tenderedAmount > 0 &&
      paymentAmount > 0 &&
      (
        method === "efectivo" ||
        tenderedAmount <=
          balance
      )
    );

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (
      !valid ||
      saving
    ) {
      return;
    }

    if (
      typeof pos
        ?.registerReceivablePayment !==
      "function"
    ) {
      pos?.showToast?.(
        "El registro de pagos no está disponible",
        true
      );
      return;
    }

    setSaving(true);

    try {
      const ok =
        await pos
          .registerReceivablePayment(
            account,
            {
              importe:
                paymentAmount,
              metodoPago:
                method,
              efectivoRecibido:
                method === "efectivo"
                  ? tenderedAmount
                  : null,
              vuelto:
                method === "efectivo"
                  ? changeAmount
                  : 0,
            }
          );

      if (ok) {
        onPaid?.();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="
          mb-4
          overflow-hidden
          rounded-[22px]
          bg-white
          text-[#111318]
        "
      >
        <div className="p-4">
          <p
            className="
              text-[10px]
              font-extrabold
              uppercase
              tracking-[0.16em]
              text-[#B98700]
            "
          >
            {account?.clienteNombre ||
              "Cliente"}
          </p>

          <div
            className="
              mt-2
              flex
              items-end
              justify-between
              gap-3
            "
          >
            <div>
              <p
                className="
                  text-xs
                  font-semibold
                  text-black/40
                "
              >
                Saldo pendiente
              </p>
              <p
                className="
                  mt-1
                  text-xl
                  font-black
                  text-[#111318]
                "
              >
                {money(balance)}
              </p>
            </div>

            <span
              className="
                rounded-full
                bg-[#FFF5CC]
                px-2.5
                py-1.5
                text-[9px]
                font-extrabold
                text-[#8C6700]
              "
            >
              Caja abierta
            </span>
          </div>
        </div>
      </div>

      <FormField
        label={
          method === "efectivo"
            ? "Efectivo recibido"
            : "Importe a cobrar"
        }
        required
      >
        <div className="relative">
          <span
            className="
              pointer-events-none
              absolute
              left-4
              top-1/2
              -translate-y-1/2
              text-base
              font-black
              text-[#FFC61A]
            "
          >
            $
          </span>

          <input
            type="number"
            min="0.01"
            max={
              method === "efectivo"
                ? undefined
                : balance
            }
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) =>
              setAmount(
                event.target.value
              )
            }
            className={`${inputClassName} pl-9`}
          />
        </div>
      </FormField>

      <div className="mb-4">
        <p
          className="
            mb-2
            text-xs
            font-bold
            text-white/55
          "
        >
          Medio de pago
        </p>

        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map(
            (item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setMethod(
                    item.id
                  )
                }
                className={
                  `
                    rounded-2xl
                    border
                    px-3
                    py-3
                    text-xs
                    font-extrabold
                    transition
                  ` +
                  (
                    method ===
                    item.id
                      ? " border-[#FFC61A]/30 bg-[#FFC61A]/10 text-[#FFC61A]"
                      : " border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                  )
                }
              >
                {item.label}
              </button>
            )
          )}
        </div>
      </div>

      {method !== "efectivo" &&
        tenderedAmount >
          balance && (
          <p
            className="
              mb-3
              rounded-xl
              border
              border-red-400/20
              bg-red-500/10
              px-3
              py-2.5
              text-xs
              font-semibold
              text-red-200
            "
          >
            El pago no puede superar el saldo pendiente.
          </p>
        )}

      {method === "efectivo" &&
        changeAmount > 0 && (
          <div
            className="
              mb-4
              rounded-2xl
              border
              border-[#FFC61A]/25
              bg-[#FFC61A]/10
              px-4
              py-3.5
            "
          >
            <div
              className="
                flex
                items-center
                justify-between
                gap-3
              "
            >
              <span
                className="
                  text-xs
                  font-bold
                  text-white/55
                "
              >
                Vuelto
              </span>

              <span
                className="
                  text-lg
                  font-black
                  text-[#FFC61A]
                "
              >
                {money(
                  changeAmount
                )}
              </span>
            </div>

            <p
              className="
                mt-1
                text-[11px]
                font-semibold
                text-white/35
              "
            >
              Se aplicarán {money(balance)} a la deuda.
            </p>
          </div>
        )}

      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="
            rounded-2xl
            border
            border-white/10
            bg-white/5
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-white/65
            transition
            hover:bg-white/10
            disabled:opacity-50
          "
        >
          Volver
        </button>

        <button
          type="submit"
          disabled={
            !valid ||
            saving
          }
          className="
            inline-flex
            items-center
            justify-center
            gap-2
            rounded-2xl
            bg-[#FFC61A]
            px-4
            py-3.5
            text-sm
            font-extrabold
            text-black
            transition
            hover:bg-[#FFD248]
            active:scale-[0.99]
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          {saving ? (
            <LoadingIcon className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" />
          )}

          {saving
            ? "Registrando..."
            : paymentAmount ===
                balance
              ? "Saldar cuenta"
              : "Registrar pago"}
        </button>
      </div>
    </form>
  );
}

function DetailRow({
  label,
  value,
}) {
  return (
    <div
      className="
        mt-3
        flex
        items-center
        justify-between
        gap-3
        rounded-[18px]
        border
        border-white/10
        bg-[#151A22]
        px-3.5
        py-3
      "
    >
      <span
        className="
          text-xs
          font-semibold
          text-white/40
        "
      >
        {label}
      </span>

      <span
        className="
          min-w-0
          truncate
          text-right
          text-xs
          font-extrabold
          text-white
        "
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   ESTADOS / STATS
========================================================= */

function EmptyState({
  hasAccounts,
  onCreate,
}) {
  return (
    <div
      className="
        rounded-[22px]
        border
        border-white/10
        bg-[#151A22]
        px-5
        py-8
        text-center
      "
    >
      <div
        className="
          mx-auto
          grid
          h-12
          w-12
          place-items-center
          rounded-2xl
          bg-[#FFC61A]/10
          text-[#FFC61A]
        "
      >
        <WalletIcon className="h-5 w-5" />
      </div>

      <p
        className="
          mt-3
          text-sm
          font-extrabold
          text-white
        "
      >
        {hasAccounts
          ? "No hay cuentas para este filtro"
          : "Todavía no hay cuentas por cobrar"}
      </p>

      <p
        className="
          mx-auto
          mt-1.5
          max-w-[290px]
          text-xs
          leading-relaxed
          text-white/40
        "
      >
        {hasAccounts
          ? "Probá con otro filtro o cambiá la búsqueda."
          : "Podés comenzar registrando una deuda actual o una anterior al POS."}
      </p>

      {!hasAccounts && (
        <button
          type="button"
          onClick={onCreate}
          className="
            mt-4
            rounded-xl
            border
            border-[#FFC61A]/25
            bg-[#FFC61A]/10
            px-3.5
            py-2.5
            text-xs
            font-extrabold
            text-[#FFC61A]
          "
        >
          + Nueva deuda
        </button>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  highlight = false,
  danger = false,
}) {
  return (
    <div
      className="
        min-w-0
        rounded-2xl
        bg-[#F4F5F7]
        p-3
      "
    >
      <span
        className="
          block
          truncate
          text-[8px]
          font-bold
          uppercase
          tracking-[0.08em]
          text-black/35
          sm:text-[9px]
        "
      >
        {label}
      </span>

      <span
        className={
          `
            mt-1
            block
            truncate
            text-sm
            font-black
            sm:text-base
          ` +
          (
            danger
              ? " text-red-600"
              : highlight
                ? " text-[#9A7100]"
                : " text-[#111318]"
          )
        }
      >
        {value}
      </span>
    </div>
  );
}

function MiniStat({
  label,
  value,
  highlight = false,
  danger = false,
}) {
  return (
    <div
      className="
        min-w-0
        rounded-xl
        border
        border-white/[0.07]
        bg-white/[0.04]
        px-2.5
        py-2
      "
    >
      <span
        className="
          block
          truncate
          text-[8px]
          font-bold
          uppercase
          tracking-[0.08em]
          text-white/30
        "
      >
        {label}
      </span>

      <span
        className={
          `
            mt-0.5
            block
            truncate
            text-xs
            font-black
          ` +
          (
            danger
              ? " text-red-300"
              : highlight
                ? " text-[#FFC61A]"
                : " text-white"
          )
        }
      >
        {value}
      </span>
    </div>
  );
}

function DarkStat({
  label,
  value,
  highlight = false,
}) {
  return (
    <div
      className="
        min-w-0
        rounded-2xl
        border
        border-white/10
        bg-[#171B23]
        p-3.5
      "
    >
      <span
        className="
          block
          truncate
          text-[9px]
          font-bold
          uppercase
          tracking-[0.1em]
          text-white/35
        "
      >
        {label}
      </span>

      <span
        className={
          `
            mt-1
            block
            truncate
            text-base
            font-black
          ` +
          (
            highlight
              ? " text-[#FFC61A]"
              : " text-white"
          )
        }
      >
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   ICONOS
========================================================= */

function WalletIcon({
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
      <path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6.5A2.5 2.5 0 0 1 4.5 4H17" />
      <path d="M16 11h6v4h-6a2 2 0 0 1 0-4Z" />
    </svg>
  );
}

function BackIcon({
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
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function PlusIcon({
  className = "",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function SearchIcon({
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
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon({
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
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function HistoryIcon({
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
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function LoadingIcon({
  className = "",
}) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
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
