// src/pages/Compras.jsx
// Lista de compras + cuentas por pagar.

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { motion } from "motion/react";
import Modal from "../components/Modal";
import { money } from "../lib/format";

const PAYMENT_METHODS = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "qr", label: "QR" },
  { id: "tarjeta", label: "Tarjeta" },
];

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toNumber(value, fallback = 0) {
  const normalized =
    typeof value === "string"
      ? value.replace(",", ".")
      : value;

  const number = Number(normalized);
  return Number.isFinite(number)
    ? number
    : fallback;
}

function isOverdue(account) {
  if (
    !account?.vencimiento ||
    toNumber(account?.saldoPendiente) <= 0
  ) {
    return false;
  }

  return account.vencimiento < today();
}

export default function Compras({ pos }) {
  const [section, setSection] =
    useState("lista");

  const [shoppingModal, setShoppingModal] =
    useState(false);

  const [completeItem, setCompleteItem] =
    useState(null);

  const [payableModal, setPayableModal] =
    useState(false);

  const [paymentAccount, setPaymentAccount] =
    useState(null);

  const shoppingList =
    Array.isArray(pos?.shoppingList)
      ? pos.shoppingList
      : [];

  const accountsPayable =
    Array.isArray(pos?.accountsPayable)
      ? pos.accountsPayable
      : [];

  const pendingPurchases =
    useMemo(
      () =>
        shoppingList.filter(
          (item) =>
            item?.estado !== "comprado"
        ),
      [shoppingList]
    );

  const completedPurchases =
    useMemo(
      () =>
        shoppingList.filter(
          (item) =>
            item?.estado === "comprado"
        ),
      [shoppingList]
    );

  const pendingAccounts =
    useMemo(
      () =>
        accountsPayable.filter(
          (account) =>
            toNumber(
              account?.saldoPendiente
            ) > 0
        ),
      [accountsPayable]
    );

  const totalPayable =
    pendingAccounts.reduce(
      (sum, account) =>
        sum +
        toNumber(
          account?.saldoPendiente
        ),
      0
    );

  const overdueCount =
    pendingAccounts.filter(
      isOverdue
    ).length;

  return (
    <div className="pb-3">
      <section
        className="mb-4 overflow-hidden rounded-[28px] bg-white text-[#111318] shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
      >
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#B98700]">
                Compras
              </p>
              <h2 className="mt-1 text-xl font-black tracking-[-0.02em]">
                Abastecimiento y pagos
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-black/45">
                Organizá lo que falta comprar y controlá lo que el negocio debe.
              </p>
            </div>

            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFF5CC] text-[#9A7100]">
              <CartIcon className="h-5 w-5" />
            </div>
          </div>

          <div className="my-5 h-[3px] rounded-full bg-[#FFC61A]" />

          <div className="grid grid-cols-3 gap-2.5">
            <SummaryStat
              label="Pendientes"
              value={pendingPurchases.length}
            />
            <SummaryStat
              label="Por pagar"
              value={money(totalPayable)}
              small
            />
            <SummaryStat
              label="Vencidas"
              value={overdueCount}
              danger={overdueCount > 0}
            />
          </div>
        </div>
      </section>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#11151C] p-1.5">
        <SectionButton
          active={section === "lista"}
          onClick={() =>
            setSection("lista")
          }
        >
          Lista de compras
        </SectionButton>

        <SectionButton
          active={section === "pagar"}
          onClick={() =>
            setSection("pagar")
          }
        >
          Cuentas por pagar
        </SectionButton>
      </div>

      {section === "lista" ? (
        <ShoppingListSection
          pending={pendingPurchases}
          completed={completedPurchases}
          onNew={() =>
            setShoppingModal(true)
          }
          onComplete={setCompleteItem}
          onRefresh={() =>
            pos.refreshPurchasingData?.()
          }
        />
      ) : (
        <AccountsPayableSection
          accounts={accountsPayable}
          total={totalPayable}
          onNew={() =>
            setPayableModal(true)
          }
          onPay={setPaymentAccount}
          onRefresh={() =>
            pos.refreshPurchasingData?.()
          }
        />
      )}

      <NewShoppingItemModal
        open={shoppingModal}
        onClose={() =>
          setShoppingModal(false)
        }
        onSave={async (payload) => {
          const ok =
            await pos.createShoppingItem?.(
              payload
            );

          if (ok) {
            setShoppingModal(false);
          }
        }}
      />

      <CompleteShoppingModal
        open={Boolean(completeItem)}
        item={completeItem}
        catalog={pos?.catalog}
        onClose={() =>
          setCompleteItem(null)
        }
        onSave={async (payload) => {
          if (!completeItem?.id) {
            return;
          }

          const ok =
            await pos.completeShoppingItem?.(
              completeItem.id,
              payload
            );

          if (ok) {
            setCompleteItem(null);
          }
        }}
      />

      <NewPayableModal
        open={payableModal}
        onClose={() =>
          setPayableModal(false)
        }
        onSave={async (payload) => {
          const ok =
            await pos.createManualPayable?.(
              payload
            );

          if (ok) {
            setPayableModal(false);
          }
        }}
      />

      <PayablePaymentModal
        open={Boolean(paymentAccount)}
        account={paymentAccount}
        onClose={() =>
          setPaymentAccount(null)
        }
        onSave={async (payload) => {
          if (!paymentAccount?.id) {
            return;
          }

          const ok =
            await pos.registerPayablePayment?.(
              paymentAccount.id,
              payload
            );

          if (ok) {
            setPaymentAccount(null);
          }
        }}
      />
    </div>
  );
}

function ShoppingListSection({
  pending,
  completed,
  onNew,
  onComplete,
  onRefresh,
}) {
  return (
    <section className="space-y-3">
      <ActionHeader
        title="Lista de compras"
        text="Anotá mercadería, insumos o cualquier compra pendiente."
        button="+ Nueva compra"
        onButton={onNew}
        onRefresh={onRefresh}
      />

      {pending.length === 0 ? (
        <EmptyState
          title="No hay compras pendientes"
          text="Agregá algo a la lista para tenerlo presente en la próxima compra."
        />
      ) : (
        <div className="space-y-2.5">
          {pending.map((item, index) => (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: Math.min(
                  index * 0.025,
                  0.12
                ),
              }}
              className="rounded-[22px] bg-white p-4 text-[#111318] shadow-[0_14px_36px_rgba(0,0,0,0.16)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#B98700]">
                    Pendiente
                  </p>
                  <h3 className="mt-1 text-base font-black">
                    {item.concepto}
                  </h3>
                  <p className="mt-1 text-xs text-black/45">
                    {item.proveedor ||
                      "Proveedor sin definir"}
                  </p>
                </div>

                <span className="shrink-0 rounded-xl bg-[#FFF5CC] px-2.5 py-1.5 text-xs font-black text-[#8B6600]">
                  x{item.cantidad || 1}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <InfoBox
                  label="Costo estimado"
                  value={money(
                    toNumber(
                      item.costoEstimado
                    )
                  )}
                />
                <InfoBox
                  label="Concepto de costo"
                  value={
                    item.conceptoCosto ||
                    "Sin detalle"
                  }
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  onComplete(item)
                }
                className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-[#FFC61A] px-4 py-3 text-sm font-extrabold text-black transition hover:bg-[#FFD248] active:scale-[0.99]"
              >
                Marcar como comprada
              </button>
            </motion.article>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <details className="rounded-[22px] border border-white/10 bg-[#11151C] p-4">
          <summary className="cursor-pointer text-sm font-extrabold text-white/70">
            Compras completadas ({completed.length})
          </summary>

          <div className="mt-3 space-y-2">
            {completed
              .slice(0, 20)
              .map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl bg-white/[0.04] px-3 py-2.5"
                >
                  <div className="flex justify-between gap-3">
                    <span className="truncate text-xs font-bold text-white/70">
                      {item.concepto}
                    </span>
                    <strong className="text-xs text-[#FFC61A]">
                      {money(
                        toNumber(
                          item.costoReal
                        )
                      )}
                    </strong>
                  </div>
                </div>
              ))}
          </div>
        </details>
      )}
    </section>
  );
}

function AccountsPayableSection({
  accounts,
  total,
  onNew,
  onPay,
  onRefresh,
}) {
  const ordered =
    [...accounts].sort((a, b) => {
      const aOpen =
        toNumber(a?.saldoPendiente) > 0;
      const bOpen =
        toNumber(b?.saldoPendiente) > 0;

      if (aOpen !== bOpen) {
        return aOpen ? -1 : 1;
      }

      const aOver = isOverdue(a);
      const bOver = isOverdue(b);

      if (aOver !== bOver) {
        return aOver ? -1 : 1;
      }

      return String(
        a?.vencimiento || "9999"
      ).localeCompare(
        String(
          b?.vencimiento || "9999"
        )
      );
    });

  return (
    <section className="space-y-3">
      <ActionHeader
        title="Cuentas por pagar"
        text={`Saldo pendiente total: ${money(total)}`}
        button="+ Nueva deuda"
        onButton={onNew}
        onRefresh={onRefresh}
      />

      {ordered.length === 0 ? (
        <EmptyState
          title="No hay cuentas por pagar"
          text="Registrá deudas con proveedores o personas para llevar el saldo pendiente."
        />
      ) : (
        <div className="space-y-2.5">
          {ordered.map((account, index) => {
            const balance =
              toNumber(
                account?.saldoPendiente
              );

            const paid = balance <= 0;
            const overdue =
              !paid &&
              isOverdue(account);

            return (
              <motion.article
                key={account.id}
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: Math.min(
                    index * 0.02,
                    0.12
                  ),
                }}
                className="rounded-[22px] border border-white/10 bg-[#11151C] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className={
                        "text-[9px] font-extrabold uppercase tracking-[0.13em] " +
                        (overdue
                          ? "text-red-300"
                          : paid
                            ? "text-emerald-300"
                            : "text-[#FFC61A]")
                      }
                    >
                      {overdue
                        ? "Vencida"
                        : paid
                          ? "Pagada"
                          : account.estado === "parcial"
                            ? "Pago parcial"
                            : "Pendiente"}
                    </p>
                    <h3 className="mt-1 truncate text-base font-black text-white">
                      {account.proveedorNombre}
                    </h3>
                    <p className="mt-1 text-xs text-white/40">
                      {account.concepto}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="block text-[9px] font-bold uppercase text-white/30">
                      Saldo
                    </span>
                    <strong className="mt-0.5 block text-base font-black text-[#FFC61A]">
                      {money(balance)}
                    </strong>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <InfoBoxDark
                    label="Importe original"
                    value={money(
                      toNumber(
                        account.importeOriginal
                      )
                    )}
                  />
                  <InfoBoxDark
                    label="Vencimiento"
                    value={
                      account.vencimiento ||
                      "Sin fecha"
                    }
                  />
                </div>

                {!paid && (
                  <button
                    type="button"
                    onClick={() =>
                      onPay(account)
                    }
                    className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-[#FFC61A] px-4 py-3 text-sm font-extrabold text-black transition hover:bg-[#FFD248] active:scale-[0.99]"
                  >
                    Registrar pago
                  </button>
                )}

                {Array.isArray(account.pagos) &&
                  account.pagos.length > 0 && (
                    <details className="mt-3 border-t border-white/8 pt-3">
                      <summary className="cursor-pointer text-[11px] font-bold text-white/40">
                        Historial de pagos ({account.pagos.length})
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        {[...account.pagos]
                          .reverse()
                          .map((pago) => (
                            <div
                              key={pago.id}
                              className="flex justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2 text-[11px]"
                            >
                              <span className="text-white/40">
                                {PAYMENT_METHODS.find(
                                  (method) =>
                                    method.id === pago.metodoPago
                                )?.label ||
                                  pago.metodoPago}
                              </span>
                              <strong className="text-white/75">
                                {money(
                                  toNumber(
                                    pago.importe
                                  )
                                )}
                              </strong>
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
              </motion.article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ActionHeader({
  title,
  text,
  button,
  onButton,
  onRefresh,
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#11151C] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-white">
            {title}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
            {text}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          title="Actualizar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 text-white/45 transition hover:text-[#FFC61A]"
        >
          <RefreshIcon className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={onButton}
        className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-[#FFC61A] px-4 py-3 text-sm font-extrabold text-black transition hover:bg-[#FFD248] active:scale-[0.99]"
      >
        {button}
      </button>
    </div>
  );
}

function NewShoppingItemModal({
  open,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState({
    concepto: "",
    proveedor: "",
    cantidad: "1",
    costoEstimado: "",
    conceptoCosto: "Mercadería",
    notas: "",
  });
  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    if (!open) return;

    setForm({
      concepto: "",
      proveedor: "",
      cantidad: "1",
      costoEstimado: "",
      conceptoCosto: "Mercadería",
      notas: "",
    });
    setSaving(false);
  }, [open]);

  function set(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submit() {
    if (
      !form.concepto.trim() ||
      saving
    ) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...form,
        cantidad:
          toNumber(
            form.cantidad,
            1
          ),
        costoEstimado:
          toNumber(
            form.costoEstimado,
            0
          ),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva compra pendiente"
    >
      <FormStack>
        <InputField
          label="Qué hay que comprar"
          value={form.concepto}
          onChange={(value) =>
            set("concepto", value)
          }
          placeholder="Ej: 2 packs de Coca-Cola"
        />
        <InputField
          label="Persona o proveedor (opcional)"
          value={form.proveedor}
          onChange={(value) =>
            set("proveedor", value)
          }
          placeholder="Ej: Distribuidora Norte"
        />

        <div className="grid grid-cols-2 gap-2.5">
          <InputField
            label="Cantidad"
            type="number"
            value={form.cantidad}
            onChange={(value) =>
              set("cantidad", value)
            }
          />
          <InputField
            label="Costo estimado"
            type="number"
            value={form.costoEstimado}
            onChange={(value) =>
              set("costoEstimado", value)
            }
            prefix="$"
          />
        </div>

        <InputField
          label="Concepto del costo"
          value={form.conceptoCosto}
          onChange={(value) =>
            set("conceptoCosto", value)
          }
          placeholder="Mercadería, flete, envases..."
        />
        <TextAreaField
          label="Notas (opcional)"
          value={form.notas}
          onChange={(value) =>
            set("notas", value)
          }
        />
        <PrimaryButton
          disabled={
            !form.concepto.trim() ||
            saving
          }
          onClick={submit}
        >
          {saving
            ? "Guardando..."
            : "Agregar a la lista"}
        </PrimaryButton>
      </FormStack>
    </Modal>
  );
}

function CompleteShoppingModal({
  open,
  item,
  catalog,
  onClose,
  onSave,
}) {
  const products =
    useMemo(
      () =>
        Object.values(
          catalog || {}
        ).filter(
          (product) =>
            product &&
            product.tipoVenta !==
              "precio-libre"
        ),
      [catalog]
    );

  const [form, setForm] = useState({
    costoReal: "",
    conceptoCosto: "Mercadería",
    sumarStock: false,
    productoBarcode: "",
    cantidadStock: "1",
    generarCuentaPorPagar: false,
    vencimiento: "",
  });
  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    if (!open) return;

    const estimatedCost =
      toNumber(
        item?.costoEstimado,
        0
      );

    const quantity =
      toNumber(
        item?.cantidad,
        1
      );

    setForm({
      costoReal:
        estimatedCost > 0
          ? String(estimatedCost)
          : "",
      conceptoCosto:
        item?.conceptoCosto ||
        "Mercadería",
      sumarStock: false,
      productoBarcode: "",
      cantidadStock:
        quantity > 0
          ? String(quantity)
          : "1",
      generarCuentaPorPagar: false,
      vencimiento: "",
    });
    setSaving(false);
  }, [
    open,
    item?.id,
    item?.costoEstimado,
    item?.cantidad,
    item?.conceptoCosto,
  ]);

  function set(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submit() {
    if (saving) return;

    if (
      form.sumarStock &&
      !form.productoBarcode
    ) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...form,
        costoReal:
          toNumber(
            form.costoReal,
            0
          ),
        cantidadStock:
          toNumber(
            form.cantidadStock,
            0
          ),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar compra"
    >
      <FormStack>
        <div className="rounded-[20px] bg-white p-4 text-[#111318]">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#B98700]">
            Compra
          </p>
          <h3 className="mt-1 text-base font-black">
            {item?.concepto || "Compra"}
          </h3>
          <p className="mt-1 text-xs text-black/40">
            {item?.proveedor ||
              "Proveedor sin definir"}
          </p>
        </div>

        <InputField
          label="Costo real total"
          type="number"
          value={form.costoReal}
          onChange={(value) =>
            set("costoReal", value)
          }
          prefix="$"
        />

        <InputField
          label="Concepto del costo"
          value={form.conceptoCosto}
          onChange={(value) =>
            set("conceptoCosto", value)
          }
          placeholder="Mercadería, flete, envases..."
        />

        <CheckRow
          checked={form.sumarStock}
          onChange={(checked) =>
            set("sumarStock", checked)
          }
          title="Ingresar esta compra al stock"
          text="También actualizará el costo promedio del producto."
        />

        {form.sumarStock && (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-white/55">
                Producto del inventario
              </span>
              <select
                value={form.productoBarcode}
                onChange={(event) =>
                  set(
                    "productoBarcode",
                    event.target.value
                  )
                }
                className="w-full rounded-2xl border border-white/10 bg-[#171B23] px-3.5 py-3 text-sm font-bold text-white outline-none focus:border-[#FFC61A]"
              >
                <option value="">
                  Seleccionar producto
                </option>
                {products.map((product) => (
                  <option
                    key={product.barcode}
                    value={product.barcode}
                  >
                    {product.name}
                  </option>
                ))}
              </select>
            </label>

            <InputField
              label="Cantidad que ingresa al stock"
              type="number"
              value={form.cantidadStock}
              onChange={(value) =>
                set("cantidadStock", value)
              }
              placeholder="1"
            />
          </>
        )}

        <CheckRow
          checked={form.generarCuentaPorPagar}
          onChange={(checked) =>
            set(
              "generarCuentaPorPagar",
              checked
            )
          }
          title="Queda pendiente de pago"
          text="Creará automáticamente una cuenta por pagar por el costo real."
        />

        {form.generarCuentaPorPagar && (
          <InputField
            label="Vencimiento (opcional)"
            type="date"
            value={form.vencimiento}
            onChange={(value) =>
              set("vencimiento", value)
            }
          />
        )}

        <PrimaryButton
          disabled={
            saving ||
            (form.sumarStock &&
              !form.productoBarcode) ||
            (form.generarCuentaPorPagar &&
              toNumber(form.costoReal) <= 0)
          }
          onClick={submit}
        >
          {saving
            ? "Registrando..."
            : "Confirmar compra"}
        </PrimaryButton>
      </FormStack>
    </Modal>
  );
}

function NewPayableModal({
  open,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState({
    proveedorNombre: "",
    concepto: "",
    importeOriginal: "",
    fechaOrigen: today(),
    vencimiento: "",
    notas: "",
  });
  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    if (!open) return;

    setForm({
      proveedorNombre: "",
      concepto: "",
      importeOriginal: "",
      fechaOrigen: today(),
      vencimiento: "",
      notas: "",
    });
    setSaving(false);
  }, [open]);

  function set(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submit() {
    if (
      saving ||
      !form.proveedorNombre.trim() ||
      !form.concepto.trim() ||
      toNumber(form.importeOriginal) <= 0
    ) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...form,
        importeOriginal:
          toNumber(
            form.importeOriginal
          ),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva cuenta por pagar"
    >
      <FormStack>
        <InputField
          label="Persona o proveedor"
          value={form.proveedorNombre}
          onChange={(value) =>
            set(
              "proveedorNombre",
              value
            )
          }
          placeholder="Ej: Juan / Distribuidora Norte"
        />
        <InputField
          label="Concepto"
          value={form.concepto}
          onChange={(value) =>
            set("concepto", value)
          }
          placeholder="Ej: Compra de mercadería"
        />
        <InputField
          label="Importe adeudado"
          type="number"
          value={form.importeOriginal}
          onChange={(value) =>
            set(
              "importeOriginal",
              value
            )
          }
          prefix="$"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <InputField
            label="Fecha de origen"
            type="date"
            value={form.fechaOrigen}
            onChange={(value) =>
              set("fechaOrigen", value)
            }
          />
          <InputField
            label="Vencimiento"
            type="date"
            value={form.vencimiento}
            onChange={(value) =>
              set("vencimiento", value)
            }
          />
        </div>
        <TextAreaField
          label="Notas (opcional)"
          value={form.notas}
          onChange={(value) =>
            set("notas", value)
          }
        />
        <PrimaryButton
          disabled={
            saving ||
            !form.proveedorNombre.trim() ||
            !form.concepto.trim() ||
            toNumber(form.importeOriginal) <= 0
          }
          onClick={submit}
        >
          {saving
            ? "Guardando..."
            : "Registrar deuda"}
        </PrimaryButton>
      </FormStack>
    </Modal>
  );
}

function PayablePaymentModal({
  open,
  account,
  onClose,
  onSave,
}) {
  const balance =
    toNumber(
      account?.saldoPendiente
    );

  const [amount, setAmount] =
    useState("");
  const [method, setMethod] =
    useState("efectivo");
  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    if (!open) return;

    setAmount("");
    setMethod("efectivo");
    setSaving(false);
  }, [
    open,
    account?.id,
  ]);

  async function submit() {
    const value =
      toNumber(
        amount,
        NaN
      );

    if (
      saving ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > balance
    ) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        importe: value,
        metodoPago: method,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar pago"
    >
      <FormStack>
        <div className="rounded-[20px] bg-white p-4 text-[#111318]">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#B98700]">
            Cuenta por pagar
          </p>
          <h3 className="mt-1 text-base font-black">
            {account?.proveedorNombre ||
              "Proveedor"}
          </h3>
          <p className="mt-1 text-xs text-black/40">
            Saldo pendiente: {money(balance)}
          </p>
        </div>

        <InputField
          label="Importe a pagar"
          type="number"
          value={amount}
          onChange={setAmount}
          prefix="$"
        />

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-white/55">
            Medio de pago
          </span>
          <select
            value={method}
            onChange={(event) =>
              setMethod(
                event.target.value
              )
            }
            className="w-full rounded-2xl border border-white/10 bg-[#171B23] px-3.5 py-3 text-sm font-bold text-white outline-none focus:border-[#FFC61A]"
          >
            {PAYMENT_METHODS.map((item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <p className="rounded-2xl border border-[#FFC61A]/15 bg-[#FFC61A]/10 px-3.5 py-3 text-[11px] leading-relaxed text-white/50">
          El pago se registra como egreso del turno actual. Si es en efectivo, reduce el efectivo esperado de la caja.
        </p>

        <PrimaryButton
          disabled={
            saving ||
            toNumber(amount) <= 0 ||
            toNumber(amount) > balance
          }
          onClick={submit}
        >
          {saving
            ? "Registrando..."
            : "Confirmar pago"}
        </PrimaryButton>
      </FormStack>
    </Modal>
  );
}

function FormStack({ children }) {
  return (
    <div className="space-y-4">
      {children}
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  prefix = null,
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-white/55">
        {label}
      </span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-[#FFC61A]">
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value
            )
          }
          placeholder={placeholder}
          step={
            type === "number"
              ? "0.01"
              : undefined
          }
          min={
            type === "number"
              ? "0"
              : undefined
          }
          className={
            "w-full rounded-2xl border border-white/10 bg-[#171B23] py-3 pr-3.5 text-sm font-semibold text-white outline-none transition placeholder:text-white/25 focus:border-[#FFC61A] focus:ring-2 focus:ring-[#FFC61A]/10 " +
            (prefix
              ? "pl-8"
              : "pl-3.5")
          }
        />
      </div>
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-white/55">
        {label}
      </span>
      <textarea
        rows="3"
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
        className="w-full resize-none rounded-2xl border border-white/10 bg-[#171B23] px-3.5 py-3 text-sm font-semibold text-white outline-none transition placeholder:text-white/25 focus:border-[#FFC61A] focus:ring-2 focus:ring-[#FFC61A]/10"
      />
    </label>
  );
}

function CheckRow({
  checked,
  onChange,
  title,
  text,
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[20px] border border-white/10 bg-[#151A22] p-3.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) =>
          onChange(
            event.target.checked
          )
        }
        className="mt-0.5 h-4 w-4 accent-[#FFC61A]"
      />
      <div>
        <p className="text-xs font-extrabold text-white/80">
          {title}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
          {text}
        </p>
      </div>
    </label>
  );
}

function PrimaryButton({
  disabled,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex w-full items-center justify-center rounded-2xl bg-[#FFC61A] px-4 py-3.5 text-sm font-extrabold text-black shadow-[0_12px_30px_rgba(255,198,26,0.18)] transition hover:bg-[#FFD248] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SectionButton({
  active,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.06em] transition " +
        (active
          ? "bg-[#FFC61A] text-black"
          : "text-white/40 hover:bg-white/5 hover:text-white/70")
      }
    >
      {children}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  danger = false,
  small = false,
}) {
  return (
    <div className="rounded-2xl bg-[#F4F5F7] px-2.5 py-2.5 text-center">
      <span className="block text-[8px] font-extrabold uppercase tracking-[0.08em] text-black/35">
        {label}
      </span>
      <strong
        className={
          "mt-1 block truncate font-black " +
          (small
            ? "text-[12px]"
            : "text-lg") +
          (danger
            ? " text-red-600"
            : " text-[#111318]")
        }
      >
        {value}
      </strong>
    </div>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-xl bg-[#F4F5F7] px-3 py-2.5">
      <span className="block text-[8px] font-extrabold uppercase tracking-[0.08em] text-black/30">
        {label}
      </span>
      <strong className="mt-1 block truncate text-[11px] font-extrabold text-[#111318]">
        {value}
      </strong>
    </div>
  );
}

function InfoBoxDark({ label, value }) {
  return (
    <div className="rounded-xl bg-white/[0.035] px-3 py-2.5">
      <span className="block text-[8px] font-extrabold uppercase tracking-[0.08em] text-white/25">
        {label}
      </span>
      <strong className="mt-1 block truncate text-[11px] font-extrabold text-white/70">
        {value}
      </strong>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="rounded-[22px] border border-dashed border-white/10 bg-[#11151C] px-5 py-9 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.04] text-[#FFC61A]">
        <CartIcon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-black text-white/75">
        {title}
      </h3>
      <p className="mx-auto mt-1 max-w-[320px] text-xs leading-5 text-white/35">
        {text}
      </p>
    </div>
  );
}

function CartIcon({ className = "" }) {
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
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M3 4h2l2.5 11h10.5l2-7H7" />
    </svg>
  );
}

function RefreshIcon({ className = "" }) {
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
      <path d="M6.5 8a7 7 0 0 1 11-1.5L20 9" />
      <path d="M17.5 16a7 7 0 0 1-11 1.5L4 15" />
    </svg>
  );
}
