// src/components/PromotionSaleModal.jsx
// Acceso rápido a promociones activas desde Vender.

import { useMemo } from "react";
import Modal from "./Modal";
import { money } from "../lib/format";
import {
  getPromotionRegularTotal,
  isPromotionCurrentlyActive,
} from "../lib/promotions";

export default function PromotionSaleModal({
  open,
  onClose,
  pos,
}) {
  const catalog = pos?.catalog || {};
  const promotions = Array.isArray(pos?.promotions)
    ? pos.promotions
    : [];

  const activePromotions = useMemo(
    () =>
      promotions
        .filter((promotion) =>
          isPromotionCurrentlyActive(promotion)
        )
        .map((promotion) => {
          const regularTotal = getPromotionRegularTotal(
            promotion,
            catalog
          );

          return {
            ...promotion,
            regularTotal,
            saving: Math.max(
              0,
              regularTotal - Number(promotion.price || 0)
            ),
          };
        })
        .filter(
          (promotion) =>
            promotion.regularTotal > 0 &&
            promotion.saving > 0
        )
        .sort((a, b) =>
          String(a.name || "").localeCompare(
            String(b.name || ""),
            "es"
          )
        ),
    [promotions, catalog]
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Promociones"
    >
      <div className="space-y-3">
        <div className="rounded-[22px] border border-[#FFC61A]/20 bg-[#FFC61A]/[0.07] p-3.5">
          <p className="text-xs font-extrabold text-white/75">
            Agregá una promoción completa al ticket
          </p>
          <p className="mt-1 text-[11px] leading-5 text-white/40">
            También se aplican automáticamente cuando escaneás las unidades necesarias por separado.
          </p>
        </div>

        {activePromotions.length === 0 ? (
          <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-8 text-center">
            <p className="text-sm font-extrabold text-white/70">
              No hay promociones activas
            </p>
            <p className="mt-1 text-xs text-white/35">
              Podés crearlas desde Stock → Promociones.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {activePromotions.map((promotion) => (
              <article
                key={promotion.id}
                className="rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="rounded-lg bg-[#FFC61A]/10 px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#FFC61A]">
                      {promotion.type === "combo" ? "Combo" : "Por cantidad"}
                    </span>

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
                    <span className="mt-0.5 block text-[9px] font-semibold text-white/30 line-through">
                      {money(promotion.regularTotal)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-500/[0.07] px-3 py-2">
                  <span className="text-[10px] font-extrabold text-emerald-400">
                    Ahorrás {money(promotion.saving)}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      const ok = pos?.addPromotionToCart?.(promotion);
                      if (ok) onClose?.();
                    }}
                    className="rounded-xl bg-[#FFC61A] px-3 py-2 text-[10px] font-black text-black transition hover:bg-[#FFD248] active:scale-[0.98]"
                  >
                    Agregar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
