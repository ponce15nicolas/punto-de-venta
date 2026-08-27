// src/components/PromotionManagerModal.jsx
// Administración de combos y promociones por cantidad.

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { money } from "../lib/format";
import {
  getPromotionCostTotal,
  getPromotionRegularTotal,
  normalizePromotion,
} from "../lib/promotions";
import { useOperator } from "./OperatorGate";

const EMPTY_FORM = {
  id: "",
  name: "",
  type: "cantidad",
  active: true,
  price: "",
  startDate: "",
  endDate: "",
  items: [
    {
      barcode: "",
      qty: "6",
    },
  ],
};

function copyForm(value = EMPTY_FORM) {
  return {
    ...value,
    items: (Array.isArray(value.items) ? value.items : []).map((item) => ({
      barcode: String(item?.barcode || ""),
      qty: String(item?.qty ?? 1),
    })),
  };
}

function productLabel(product) {
  if (!product) return "Producto";
  return `${product.name} · ${money(product.price)}`;
}

export default function PromotionManagerModal({
  open,
  onClose,
  pos,
}) {
  const { esAdministrador } = useOperator();
  const catalog = pos?.catalog || {};
  const promotions = Array.isArray(pos?.promotions)
    ? pos.promotions
    : [];

  const products = useMemo(
    () =>
      Object.values(catalog)
        .filter(
          (product) =>
            product &&
            product.tipoVenta === "unidad"
        )
        .sort((a, b) =>
          String(a?.name || "").localeCompare(
            String(b?.name || ""),
            "es"
          )
        ),
    [catalog]
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(copyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setForm(copyForm());
      setSaving(false);
      setDeletingId("");
    }
  }, [open]);

  function startNew(type = "cantidad") {
    setForm(
      copyForm({
        ...EMPTY_FORM,
        type,
        items:
          type === "combo"
            ? [
                { barcode: "", qty: "1" },
                { barcode: "", qty: "1" },
              ]
            : [
                { barcode: "", qty: "6" },
              ],
      })
    );
    setEditing(true);
  }

  function startEdit(promotion) {
    const normalized = normalizePromotion(promotion);

    if (!normalized) return;

    setForm(
      copyForm({
        ...normalized,
        price: String(normalized.price),
        startDate: normalized.startDate || "",
        endDate: normalized.endDate || "",
      })
    );
    setEditing(true);
  }

  function setField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function setType(type) {
    setForm((current) => ({
      ...current,
      type,
      items:
        type === "combo"
          ? current.items.length >= 2
            ? current.items
            : [
                current.items[0] || { barcode: "", qty: "1" },
                { barcode: "", qty: "1" },
              ]
          : [
              current.items[0] || { barcode: "", qty: "6" },
            ],
    }));
  }

  function setItem(index, field, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item
      ),
    }));
  }

  function addComboItem() {
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        { barcode: "", qty: "1" },
      ],
    }));
  }

  function removeComboItem(index) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  const previewPromotion = useMemo(
    () =>
      normalizePromotion({
        ...form,
        price: Number(form.price),
        items: form.items.map((item) => ({
          barcode: item.barcode,
          qty: Number(item.qty),
        })),
      }),
    [form]
  );

  const regularTotal = useMemo(
    () =>
      previewPromotion
        ? getPromotionRegularTotal(
            previewPromotion,
            catalog
          )
        : 0,
    [previewPromotion, catalog]
  );

  const promotionCost = useMemo(
    () =>
      previewPromotion
        ? getPromotionCostTotal(
            previewPromotion,
            catalog
          )
        : 0,
    [previewPromotion, catalog]
  );

  const promoPrice = Number(form.price);
  const promoSaving =
    Number.isFinite(promoPrice) && regularTotal > 0
      ? Math.max(0, regularTotal - promoPrice)
      : 0;

  const promoProfit =
    Number.isFinite(promoPrice)
      ? promoPrice - promotionCost
      : 0;

  async function save() {
    if (!esAdministrador || saving) return;

    const name = form.name.trim();
    const price = Number(form.price);
    const normalizedItems = form.items.map((item) => ({
      barcode: String(item.barcode || "").trim(),
      qty: Math.trunc(Number(item.qty)),
    }));

    if (!name) {
      pos?.showToast?.("Ingresá el nombre de la promoción", true);
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      pos?.showToast?.("Ingresá un precio promocional válido", true);
      return;
    }

    if (
      normalizedItems.some(
        (item) =>
          !item.barcode ||
          !Number.isFinite(item.qty) ||
          item.qty <= 0
      )
    ) {
      pos?.showToast?.("Revisá los productos y cantidades", true);
      return;
    }

    if (new Set(normalizedItems.map((item) => item.barcode)).size !== normalizedItems.length) {
      pos?.showToast?.("No repitas el mismo producto dentro de una promoción", true);
      return;
    }

    if (form.type === "cantidad" && normalizedItems.length !== 1) {
      pos?.showToast?.("La promoción por cantidad usa un solo producto", true);
      return;
    }

    if (form.type === "combo" && normalizedItems.length < 2) {
      pos?.showToast?.("El combo necesita al menos dos productos", true);
      return;
    }

    if (regularTotal <= 0 || price > regularTotal) {
      pos?.showToast?.(
        "El precio del combo no puede superar el precio normal. Puede ser igual si no querés ofrecer ahorro.",
        true
      );
      return;
    }

    setSaving(true);

    try {
      const saved = await pos?.upsertPromotion?.({
        ...(form.id ? { id: form.id } : {}),
        name,
        type: form.type,
        active: form.active,
        price,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        items: normalizedItems,
      });

      if (saved) {
        setEditing(false);
        setForm(copyForm());
      }
    } finally {
      setSaving(false);
    }
  }

  async function togglePromotion(promotion) {
    if (!esAdministrador || saving) return;

    setSaving(true);

    try {
      await pos?.upsertPromotion?.({
        ...promotion,
        active: promotion.active === false,
      });
    } finally {
      setSaving(false);
    }
  }

  async function removePromotion(promotion) {
    if (!esAdministrador || deletingId) return;

    const confirmed = window.confirm(
      `¿Eliminar la promoción "${promotion.name}"?`
    );

    if (!confirmed) return;

    setDeletingId(promotion.id);

    try {
      await pos?.deletePromotion?.(promotion.id);
    } finally {
      setDeletingId("");
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving && !deletingId) onClose?.();
      }}
      title={editing ? "Configurar promoción" : "Promociones"}
    >
      {!editing ? (
        <div className="space-y-3">
          <div className="rounded-[22px] border border-[#FFC61A]/20 bg-[#FFC61A]/[0.07] p-3.5">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#FFC61A]">
              Precios especiales
            </p>
            <p className="mt-1 text-xs leading-5 text-white/45">
              Las promociones usan productos reales del inventario. Al vender, el stock se descuenta por cada componente y la ganancia usa el costo guardado de esos productos.
            </p>
          </div>

          {esAdministrador && (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => startNew("cantidad")}
                className="rounded-2xl bg-[#FFC61A] px-3 py-3 text-xs font-extrabold text-black transition hover:bg-[#FFD248] active:scale-[0.99]"
              >
                + Precio por cantidad
              </button>

              <button
                type="button"
                onClick={() => startNew("combo")}
                className="rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3 text-xs font-extrabold text-white/75 transition hover:border-[#FFC61A]/25 hover:text-white active:scale-[0.99]"
              >
                + Nuevo combo
              </button>
            </div>
          )}

          {!esAdministrador && (
            <p className="rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-3 text-xs text-white/45">
              La edición de promociones requiere un Administrador.
            </p>
          )}

          {promotions.length === 0 ? (
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-8 text-center">
              <p className="text-sm font-extrabold text-white/75">Todavía no hay promociones</p>
              <p className="mt-1 text-xs text-white/35">Creá un precio x cantidad o un combo para comenzar.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {promotions.map((promotion) => {
                const normal = getPromotionRegularTotal(promotion, catalog);
                const currentCost = getPromotionCostTotal(promotion, catalog);
                const promotionPrice = Number(promotion.price || 0);
                const currentSaving = Math.max(0, normal - promotionPrice);
                const currentProfit = promotionPrice - currentCost;

                return (
                  <article
                    key={promotion.id}
                    className="rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-lg bg-[#FFC61A]/10 px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#FFC61A]">
                            {promotion.type === "combo" ? "Combo" : "Por cantidad"}
                          </span>
                          <span className={`rounded-lg px-2 py-1 text-[9px] font-extrabold ${promotion.active === false ? "bg-white/5 text-white/30" : "bg-emerald-500/10 text-emerald-400"}`}>
                            {promotion.active === false ? "Inactiva" : "Activa"}
                          </span>
                        </div>

                        <h3 className="mt-2 truncate text-sm font-black text-white">
                          {promotion.name}
                        </h3>

                        <p className="mt-1 text-[10px] leading-5 text-white/40">
                          {promotion.items
                            .map((item) => {
                              const product = catalog[item.barcode];
                              return `${item.qty}× ${product?.name || item.barcode}`;
                            })
                            .join(" + ")}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <strong className="block text-base font-black text-[#FFC61A]">
                          {money(promotion.price)}
                        </strong>
                        {normal > 0 && (
                          <span className="mt-0.5 block text-[9px] font-semibold text-white/30">
                            Normal {money(normal)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-emerald-500/[0.07] px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-emerald-400/60">Ahorro actual</span>
                        <strong className="mt-0.5 block text-[11px] font-black text-emerald-400">{money(currentSaving)}</strong>
                      </div>
                      <div className={`rounded-xl px-3 py-2 ${currentProfit >= 0 ? "bg-[#FFC61A]/[0.07]" : "bg-red-500/[0.07]"}`}>
                        <span className={`block text-[9px] font-bold uppercase tracking-[0.08em] ${currentProfit >= 0 ? "text-[#FFC61A]/60" : "text-red-400/60"}`}>Ganancia estimada</span>
                        <strong className={`mt-0.5 block text-[11px] font-black ${currentProfit >= 0 ? "text-[#FFC61A]" : "text-red-400"}`}>{money(currentProfit)}</strong>
                      </div>
                    </div>

                    {esAdministrador && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={saving || Boolean(deletingId)}
                          onClick={() => startEdit(promotion)}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-[10px] font-extrabold text-white/60 transition hover:text-white disabled:opacity-40"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={saving || Boolean(deletingId)}
                          onClick={() => togglePromotion(promotion)}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-[10px] font-extrabold text-white/60 transition hover:text-white disabled:opacity-40"
                        >
                          {promotion.active === false ? "Activar" : "Pausar"}
                        </button>
                        <button
                          type="button"
                          disabled={saving || Boolean(deletingId)}
                          onClick={() => removePromotion(promotion)}
                          className="rounded-xl border border-red-400/15 bg-red-500/[0.06] px-2 py-2 text-[10px] font-extrabold text-red-300 transition hover:bg-red-500/10 disabled:opacity-40"
                        >
                          {deletingId === promotion.id ? "..." : "Eliminar"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("cantidad")}
              className={`rounded-2xl border px-3 py-3 text-xs font-extrabold transition ${form.type === "cantidad" ? "border-[#FFC61A]/40 bg-[#FFC61A] text-black" : "border-white/10 bg-white/[0.035] text-white/55"}`}
            >
              Por cantidad
            </button>
            <button
              type="button"
              onClick={() => setType("combo")}
              className={`rounded-2xl border px-3 py-3 text-xs font-extrabold transition ${form.type === "combo" ? "border-[#FFC61A]/40 bg-[#FFC61A] text-black" : "border-white/10 bg-white/[0.035] text-white/55"}`}
            >
              Combo
            </button>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-white/40">Nombre</span>
            <input
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              placeholder={form.type === "combo" ? "Ej. Fernet + Coca" : "Ej. Pack x6"}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm font-bold text-white outline-none focus:border-[#FFC61A]/45"
            />
          </label>

          <div className="space-y-2.5">
            {form.items.map((item, index) => (
              <div key={index} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="grid grid-cols-[1fr_88px] gap-2">
                  <label className="min-w-0">
                    <span className="mb-1.5 block text-[9px] font-extrabold uppercase tracking-[0.1em] text-white/35">Producto</span>
                    <select
                      value={item.barcode}
                      onChange={(event) => setItem(index, "barcode", event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#171B23] px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-[#FFC61A]/45"
                    >
                      <option value="">Seleccionar...</option>
                      {products.map((product) => (
                        <option key={product.barcode} value={product.barcode}>
                          {productLabel(product)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="mb-1.5 block text-[9px] font-extrabold uppercase tracking-[0.1em] text-white/35">Cantidad</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={item.qty}
                      onChange={(event) => setItem(index, "qty", event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#171B23] px-3 py-2.5 text-center text-xs font-black text-white outline-none focus:border-[#FFC61A]/45"
                    />
                  </label>
                </div>

                {form.type === "combo" && form.items.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeComboItem(index)}
                    className="mt-2 text-[10px] font-extrabold text-red-300/70 hover:text-red-300"
                  >
                    Quitar componente
                  </button>
                )}
              </div>
            ))}

            {form.type === "combo" && form.items.length < 12 && (
              <button
                type="button"
                onClick={addComboItem}
                className="w-full rounded-2xl border border-dashed border-white/15 bg-white/[0.025] px-3 py-2.5 text-xs font-extrabold text-white/45 transition hover:border-[#FFC61A]/30 hover:text-white/70"
              >
                + Agregar otro producto
              </button>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-white/40">Precio promocional</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-[#FFC61A]">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => setField("price", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3 pl-8 pr-3.5 text-lg font-black text-white outline-none focus:border-[#FFC61A]/45"
              />
            </div>
          </label>

          {regularTotal > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl bg-white/[0.035] px-3 py-2.5">
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">Precio normal</span>
                <strong className="mt-0.5 block text-sm font-black text-white/70">{money(regularTotal)}</strong>
              </div>
              <div className="rounded-2xl bg-white/[0.035] px-3 py-2.5">
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">Costo</span>
                <strong className="mt-0.5 block text-sm font-black text-white/70">{money(promotionCost)}</strong>
              </div>
              <div className="rounded-2xl bg-emerald-500/[0.07] px-3 py-2.5">
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-400/60">Ahorro cliente</span>
                <strong className="mt-0.5 block text-sm font-black text-emerald-400">{money(promoSaving)}</strong>
              </div>
              <div className={`rounded-2xl px-3 py-2.5 ${promoProfit >= 0 ? "bg-[#FFC61A]/[0.07]" : "bg-red-500/[0.07]"}`}>
                <span className={`block text-[9px] font-bold uppercase tracking-[0.1em] ${promoProfit >= 0 ? "text-[#FFC61A]/60" : "text-red-400/60"}`}>Ganancia negocio</span>
                <strong className={`mt-0.5 block text-sm font-black ${promoProfit >= 0 ? "text-[#FFC61A]" : "text-red-400"}`}>{money(promoProfit)}</strong>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1.5 block text-[9px] font-extrabold uppercase tracking-[0.1em] text-white/35">Desde · opcional</span>
              <input
                type="date"
                value={form.startDate}
                onChange={(event) => setField("startDate", event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#171B23] px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-[#FFC61A]/45"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[9px] font-extrabold uppercase tracking-[0.1em] text-white/35">Hasta · opcional</span>
              <input
                type="date"
                value={form.endDate}
                onChange={(event) => setField("endDate", event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#171B23] px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-[#FFC61A]/45"
              />
            </label>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
            <span>
              <strong className="block text-xs font-extrabold text-white/75">Promoción activa</strong>
              <span className="mt-0.5 block text-[10px] text-white/35">Si la pausás, deja de aplicarse sin eliminarla.</span>
            </span>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setField("active", event.target.checked)}
              className="h-5 w-5 accent-[#FFC61A]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3.5 text-sm font-extrabold text-white/55 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-2xl bg-[#FFC61A] px-3 py-3.5 text-sm font-extrabold text-black transition hover:bg-[#FFD248] disabled:opacity-40"
            >
              {saving ? "Guardando..." : "Guardar promoción"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
