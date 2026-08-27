// src/lib/pdf.js
//
// Generación de reportes PDF de cierres de caja.
//
// Compatible con:
// - productos por unidad
// - productos por peso
// - productos con importe libre
//
// El PDF se genera completamente en el navegador.
// No se envían datos a ningún servidor externo.
//
// No requiere dependencias nuevas.

import { jsPDF } from "jspdf";
import { money } from "./format";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const COLORS = {
  dark: [17, 19, 24],
  muted: [105, 110, 120],
  light: [244, 245, 247],
  line: [225, 227, 231],
  yellow: [255, 198, 26],
  yellowDark: [154, 113, 0],
  red: [210, 60, 60],
  green: [36, 150, 100],
  white: [255, 255, 255],
};

const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR",
  tarjeta: "Tarjeta",
  cuenta: "A cuenta",
  mixto: "Pago combinado",
};

const PAYMENT_ORDER = [
  "efectivo",
  "transferencia",
  "qr",
  "tarjeta",
  "cuenta",
];

/* =========================================================
   HELPERS NUMÉRICOS
========================================================= */

function number(
  value,
  fallback = 0
) {
  const result =
    Number(value);

  return Number.isFinite(
    result
  )
    ? result
    : fallback;
}

function roundMoney(value) {
  return (
    Math.round(
      (
        number(value) +
        Number.EPSILON
      ) * 100
    ) / 100
  );
}

function roundQuantity(value) {
  return (
    Math.round(
      (
        number(value) +
        Number.EPSILON
      ) * 1000
    ) / 1000
  );
}

/* =========================================================
   TIPO DE PRODUCTO
========================================================= */

function getTipoVenta(item) {
  const tipo =
    item?.tipoVenta;

  if (
    tipo === "peso" ||
    tipo === "precio-libre"
  ) {
    return tipo;
  }

  /*
   * Compatibilidad con ventas antiguas.
   */
  return "unidad";
}

function formatQuantity(value) {
  return roundQuantity(
    value
  ).toLocaleString(
    "es-AR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }
  );
}

/* =========================================================
   SUBTOTAL
========================================================= */

function getItemSubtotal(item) {
  if (!item) {
    return 0;
  }

  const storedSubtotal =
    Number(
      item.subtotal
    );

  /*
   * Las ventas nuevas almacenan subtotal.
   * Lo preferimos porque en ventas por peso
   * puede existir redondeo monetario.
   */
  if (
    Number.isFinite(
      storedSubtotal
    )
  ) {
    return roundMoney(
      storedSubtotal
    );
  }

  /*
   * Compatibilidad con ventas anteriores.
   */
  return roundMoney(
    number(
      item.qty
    ) *
      number(
        item.price
      )
  );
}

/* =========================================================
   TEXTO DEL PRODUCTO
========================================================= */

function getProductMainText(item) {
  const tipoVenta =
    getTipoVenta(
      item
    );

  const name =
    String(
      item?.name ||
        "Producto"
    ).trim() ||
    "Producto";

  if (
    tipoVenta === "peso"
  ) {
    return `${formatQuantity(
      item?.qty
    )} kg x ${name}`;
  }

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return name;
  }

  const qty =
    Math.max(
      0,
      Math.trunc(
        number(
          item?.qty
        )
      )
    );

  return `${qty} x ${name}`;
}

function getProductSecondaryText(
  item
) {
  const tipoVenta =
    getTipoVenta(
      item
    );

  if (
    tipoVenta === "peso"
  ) {
    return `${money(
      item?.price
    )} / kg`;
  }

  if (
    tipoVenta ===
    "precio-libre"
  ) {
    return "Importe manual";
  }

  return `${money(
    item?.price
  )} c/u`;
}

/* =========================================================
   LIMPIEZA DE TEXTO
========================================================= */

function cleanPdfText(value) {
  return String(
    value ?? ""
  )
    .replace(
      /[–—−]/g,
      "-"
    )
    .replace(
      /\u00A0/g,
      " "
    )
    .replace(
      /[^\x20-\x7E\u00A0-\u00FF]/g,
      "?"
    );
}

function safeFileSegment(value) {
  return String(
    value ||
      "mi-negocio"
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-zA-Z0-9-_]+/g,
      "-"
    )
    .replace(
      /-+/g,
      "-"
    )
    .replace(
      /^-|-$/g,
      ""
    )
    .toLowerCase()
    .slice(
      0,
      40
    );
}

/* =========================================================
   FECHAS
========================================================= */

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function formatDateTime(value) {
  const date =
    parseDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  )
    .format(date)
    .replace(
      ",",
      ""
    );
}

function formatTime(value) {
  const date =
    parseDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(date);
}

function fileDate(value) {
  const date =
    parseDate(value) ||
    new Date();

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() +
        1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}

/* =========================================================
   DIFERENCIA
========================================================= */

function formatDifference(value) {
  const diff =
    roundMoney(
      value
    );

  if (diff > 0) {
    return `+ ${money(
      diff
    )}`;
  }

  if (diff < 0) {
    return `- ${money(
      Math.abs(diff)
    )}`;
  }

  return money(0);
}

/* =========================================================
   MÉTODO DE PAGO
========================================================= */

function normalizePaymentMethod(
  method
) {
  return PAYMENT_LABELS[
    method
  ]
    ? method
    : "efectivo";
}

function paymentLabel(method) {
  return PAYMENT_LABELS[
    normalizePaymentMethod(
      method
    )
  ];
}

/* =========================================================
   DESGLOSE DE PAGOS
========================================================= */

function getPaymentTotals(
  session,
  sales
) {
  const totals = {
    efectivo: 0,
    transferencia: 0,
    qr: 0,
    tarjeta: 0,
    cuenta: 0,
  };

  /*
   * Si la caja fue cerrada con los totales
   * almacenados, usamos esos valores.
   */
  if (
    session?.paymentTotals &&
    typeof session.paymentTotals ===
      "object"
  ) {
    PAYMENT_ORDER.forEach(
      (method) => {
        if (
          method ===
          "cuenta"
        ) {
          return;
        }

        totals[
          method
        ] =
          roundMoney(
            session
              .paymentTotals[
                method
              ]
          );
      }
    );

    totals.cuenta =
      roundMoney(
        sales.reduce(
          (
            accumulator,
            sale
          ) =>
            sale?.payment
              ?.method ===
            "cuenta"
              ? accumulator +
                number(
                  sale?.total
                )
              : accumulator,
          0
        )
      );

    return totals;
  }

  /*
   * Compatibilidad con cajas antiguas.
   */
  sales.forEach(
    (sale) => {
      const method =
        normalizePaymentMethod(
          sale?.payment
            ?.method
        );

      if (
        method === "mixto"
      ) {
        const parts =
          Array.isArray(
            sale?.payment
              ?.parts
          )
            ? sale.payment.parts
            : [];

        for (
          const part of parts
        ) {
          const partMethod =
            String(
              part?.method ||
              ""
            );

          if (
            !PAYMENT_ORDER.includes(
              partMethod
            ) ||
            partMethod ===
              "cuenta"
          ) {
            continue;
          }

          totals[
            partMethod
          ] =
            roundMoney(
              totals[
                partMethod
              ] +
                number(
                  part?.amount
                )
            );
        }

        return;
      }

      totals[
        method
      ] =
        roundMoney(
          totals[
            method
          ] +
            number(
              sale?.total
            )
        );
    }
  );

  return totals;
}

/* =========================================================
   GENERAR PDF
========================================================= */

export function downloadSessionPdf({
  session,
  sales = [],
  shopName = "Mi Negocio",
}) {
  if (
    !session ||
    session.status !==
      "closed"
  ) {
    throw new Error(
      "La caja debe estar cerrada para generar el PDF."
    );
  }

  /* =======================================================
     VENTAS DEL TURNO
  ======================================================= */

  const safeSales =
    Array.isArray(
      sales
    )
      ? sales
      : [];

  const sessionSales =
    safeSales
      .filter(
        (sale) =>
          sale?.sessionId ===
          session.id
      )
      .slice()
      .sort(
        (a, b) => {
          const dateA =
            parseDate(
              a?.timestamp
            )?.getTime() ||
            0;

          const dateB =
            parseDate(
              b?.timestamp
            )?.getTime() ||
            0;

          return (
            dateA -
            dateB
          );
        }
      );

  const paymentTotals =
    getPaymentTotals(
      session,
      sessionSales
    );

  /* =======================================================
     DOCUMENTO
  ======================================================= */

  const doc =
    new jsPDF({
      orientation:
        "portrait",

      unit: "mm",

      format: "a4",

      compress: true,
    });

  const pageWidth =
    doc.internal.pageSize.getWidth();

  const pageHeight =
    doc.internal.pageSize.getHeight();

  const margin = 14;

  const contentWidth =
    pageWidth -
    margin * 2;

  const bottomLimit =
    pageHeight -
    20;

  let y = 14;

  /* =======================================================
     NUEVA PÁGINA
  ======================================================= */

  function continuationHeader() {
    doc.setFillColor(
      ...COLORS.yellow
    );

    doc.rect(
      margin,
      10,
      contentWidth,
      1.5,
      "F"
    );

    doc.setTextColor(
      ...COLORS.dark
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      9
    );

    doc.text(
      cleanPdfText(
        shopName
      ),
      margin,
      17
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setTextColor(
      ...COLORS.muted
    );

    doc.setFontSize(
      8
    );

    doc.text(
      "Cierre de caja - continuacion",
      pageWidth -
        margin,
      17,
      {
        align:
          "right",
      }
    );

    y = 24;
  }

  function ensureSpace(
    requiredHeight = 10
  ) {
    if (
      y +
        requiredHeight >
      bottomLimit
    ) {
      doc.addPage();

      continuationHeader();
    }
  }

  /* =======================================================
     TÍTULO DE SECCIÓN
  ======================================================= */

  function sectionTitle(title) {
    ensureSpace(
      12
    );

    doc.setTextColor(
      ...COLORS.yellowDark
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      9
    );

    doc.text(
      cleanPdfText(
        String(
          title ||
            ""
        ).toUpperCase()
      ),
      margin,
      y
    );

    y += 3;

    doc.setDrawColor(
      ...COLORS.line
    );

    doc.setLineWidth(
      0.3
    );

    doc.line(
      margin,
      y,
      pageWidth -
        margin,
      y
    );

    y += 6;
  }

  /* =======================================================
     TARJETA ESTADÍSTICA
  ======================================================= */

  function statBox(
    label,
    value,
    x,
    top,
    width,
    options = {}
  ) {
    const {
      highlight = false,
      danger = false,
      success = false,
    } = options;

    doc.setFillColor(
      ...COLORS.light
    );

    doc.roundedRect(
      x,
      top,
      width,
      15,
      3,
      3,
      "F"
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      6.8
    );

    doc.setTextColor(
      ...COLORS.muted
    );

    doc.text(
      cleanPdfText(
        String(
          label ||
            ""
        ).toUpperCase()
      ),
      x + 3,
      top + 5
    );

    doc.setFontSize(
      10
    );

    if (danger) {
      doc.setTextColor(
        ...COLORS.red
      );
    } else if (
      success
    ) {
      doc.setTextColor(
        ...COLORS.green
      );
    } else if (
      highlight
    ) {
      doc.setTextColor(
        ...COLORS.yellowDark
      );
    } else {
      doc.setTextColor(
        ...COLORS.dark
      );
    }

    const safeValue =
      cleanPdfText(
        value
      );

    /*
     * Evitamos que un valor largo
     * salga fuera de la tarjeta.
     */
    const valueLines =
      doc.splitTextToSize(
        safeValue,
        width - 6
      );

    doc.text(
      valueLines.slice(
        0,
        1
      ),
      x + 3,
      top + 11.5
    );
  }

  /* =======================================================
     ENCABEZADO
  ======================================================= */

  doc.setFillColor(
    ...COLORS.dark
  );

  doc.roundedRect(
    margin,
    y,
    contentWidth,
    36,
    5,
    5,
    "F"
  );

  doc.setFillColor(
    ...COLORS.yellow
  );

  doc.roundedRect(
    margin,
    y,
    4,
    36,
    2,
    2,
    "F"
  );

  doc.setTextColor(
    ...COLORS.yellow
  );

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setFontSize(
    8
  );

  doc.text(
    "PUNTO DE VENTA",
    margin + 9,
    y + 9
  );

  doc.setTextColor(
    ...COLORS.white
  );

  doc.setFontSize(
    18
  );

  const businessName =
    cleanPdfText(
      shopName ||
        "Mi Negocio"
    );

  const businessLines =
    doc.splitTextToSize(
      businessName,
      contentWidth -
        75
    );

  doc.text(
    businessLines.slice(
      0,
      1
    ),
    margin + 9,
    y + 18
  );

  doc.setFontSize(
    11
  );

  doc.text(
    "Reporte de cierre de caja",
    margin + 9,
    y + 27
  );

  doc.setTextColor(
    180,
    184,
    192
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(
    7.5
  );

  doc.text(
    `Cierre: ${cleanPdfText(
      formatDateTime(
        session.closeTime
      )
    )}`,
    pageWidth -
      margin -
      6,
    y + 27,
    {
      align:
        "right",
    }
  );

  y += 44;

  /* =======================================================
     DATOS DEL TURNO
  ======================================================= */

  sectionTitle(
    "Datos del turno"
  );

  doc.setFontSize(
    9
  );

  doc.setTextColor(
    ...COLORS.dark
  );

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.text(
    "Apertura:",
    margin,
    y
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.text(
    cleanPdfText(
      formatDateTime(
        session.openTime
      )
    ),
    margin + 24,
    y
  );

  y += 5;

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.text(
    "Cierre:",
    margin,
    y
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.text(
    cleanPdfText(
      formatDateTime(
        session.closeTime
      )
    ),
    margin + 24,
    y
  );

  y += 5;

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.text(
    "ID del turno:",
    margin,
    y
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(
    7
  );

  const sessionId =
    cleanPdfText(
      session.id ||
        "-"
    );

  const sessionIdLines =
    doc.splitTextToSize(
      sessionId,
      contentWidth -
        28
    );

  doc.text(
    sessionIdLines.slice(
      0,
      1
    ),
    margin + 24,
    y
  );

  y += 9;

  /* =======================================================
     RESUMEN
  ======================================================= */

  sectionTitle(
    "Resumen del cierre"
  );

  const gap = 4;

  const boxWidth =
    (
      contentWidth -
      gap
    ) / 2;

  statBox(
    "Fondo inicial",
    money(
      session.openAmount
    ),
    margin,
    y,
    boxWidth
  );

  statBox(
    "Ventas",
    money(
      session.totalSales
    ),
    margin +
      boxWidth +
      gap,
    y,
    boxWidth,
    {
      highlight: true,
    }
  );

  y += 19;

  statBox(
    "Tickets",
    String(
      session.salesCount ??
        sessionSales.length
    ),
    margin,
    y,
    boxWidth
  );

  /*
   * Contamos líneas de productos, no qty.
   * De esa forma 0,650 kg no se transforma
   * en 0,65 productos.
   */
  const productLines =
    sessionSales.reduce(
      (
        total,
        sale
      ) =>
        total +
        (
          Array.isArray(
            sale?.items
          )
            ? sale.items
                .length
            : 0
        ),
      0
    );

  statBox(
    "Productos vendidos",
    String(
      productLines
    ),
    margin +
      boxWidth +
      gap,
    y,
    boxWidth
  );

  y += 19;

  statBox(
    "Efectivo esperado",
    money(
      session.expectedAmount
    ),
    margin,
    y,
    boxWidth
  );

  statBox(
    "Efectivo contado",
    money(
      session.counted
    ),
    margin +
      boxWidth +
      gap,
    y,
    boxWidth
  );

  y += 19;

  const diff =
    roundMoney(
      session.diff
    );

  statBox(
    "Diferencia",
    formatDifference(
      diff
    ),
    margin,
    y,
    contentWidth,
    {
      danger:
        diff < 0,

      success:
        diff === 0,

      highlight:
        diff > 0,
    }
  );

  y += 22;

  /* =======================================================
     MÉTODOS DE PAGO
  ======================================================= */

  sectionTitle(
    "Ventas por metodo de pago"
  );

  const paymentRows =
    Math.ceil(
      PAYMENT_ORDER.length /
      2
    );

  PAYMENT_ORDER.forEach(
    (
      method,
      index
    ) => {
      const column =
        index % 2;

      const row =
        Math.floor(
          index / 2
        );

      const x =
        margin +
        column *
          (
            boxWidth +
            gap
          );

      const top =
        y +
        row * 19;

      statBox(
        paymentLabel(
          method
        ),
        money(
          paymentTotals[
            method
          ]
        ),
        x,
        top,
        boxWidth,
        {
          highlight:
            method ===
            "efectivo",
        }
      );
    }
  );

  y +=
    paymentRows *
    19 +
    4;

  /* =======================================================
     TRANSACCIONES
  ======================================================= */

  sectionTitle(
    "Detalle de transacciones"
  );

  if (
    sessionSales.length ===
    0
  ) {
    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      9
    );

    doc.setTextColor(
      ...COLORS.muted
    );

    doc.text(
      "No hay transacciones guardadas para este turno.",
      margin,
      y
    );

    y += 8;
  }

  sessionSales.forEach(
    (
      sale,
      saleIndex
    ) => {
      ensureSpace(
        20
      );

      /* ---------------------------------------------------
         CABECERA DE TRANSACCIÓN
      --------------------------------------------------- */

      doc.setFillColor(
        250,
        250,
        251
      );

      doc.roundedRect(
        margin,
        y,
        contentWidth,
        12,
        2.5,
        2.5,
        "F"
      );

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(
        8.5
      );

      doc.setTextColor(
        ...COLORS.dark
      );

      doc.text(
        `Venta #${
          saleIndex + 1
        }`,
        margin + 3,
        y + 5
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(
        7.5
      );

      doc.setTextColor(
        ...COLORS.muted
      );

      doc.text(
        cleanPdfText(
          `${formatTime(
            sale.timestamp
          )} - ${paymentLabel(
            sale?.payment
              ?.method
          )}`
        ),
        margin + 3,
        y + 9
      );

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(
        10
      );

      doc.setTextColor(
        ...COLORS.dark
      );

      doc.text(
        cleanPdfText(
          money(
            sale.total
          )
        ),
        pageWidth -
          margin -
          3,
        y + 7,
        {
          align:
            "right",
        }
      );

      y += 16;

      const paymentParts =
        sale?.payment?.method ===
          "mixto" &&
        Array.isArray(
          sale?.payment?.parts
        )
          ? sale.payment.parts
              .filter(
                (part) =>
                  PAYMENT_ORDER.includes(
                    part?.method
                  ) &&
                  part?.method !==
                    "cuenta" &&
                  roundMoney(
                    part?.amount
                  ) > 0
              )
          : [];

      if (
        paymentParts.length >
        0
      ) {
        paymentParts.forEach(
          (part) => {
            ensureSpace(7);

            doc.setFont(
              "helvetica",
              "bold"
            );

            doc.setFontSize(
              7.5
            );

            doc.setTextColor(
              ...COLORS.muted
            );

            const cashExtra =
              part?.method ===
                "efectivo" &&
              roundMoney(
                part?.change
              ) > 0
                ? ` - Recibido ${money(
                    part?.received
                  )} - Vuelto ${money(
                    part?.change
                  )}`
                : "";

            doc.text(
              cleanPdfText(
                `${paymentLabel(
                  part?.method
                )}: ${money(
                  part?.amount
                )}${cashExtra}`
              ),
              margin + 3,
              y
            );

            y += 5;
          }
        );

        y += 1;
      }

      /* ---------------------------------------------------
         PRODUCTOS
      --------------------------------------------------- */

      const items =
        Array.isArray(
          sale?.items
        )
          ? sale.items
          : [];

      if (
        items.length === 0
      ) {
        ensureSpace(
          7
        );

        doc.setFont(
          "helvetica",
          "italic"
        );

        doc.setFontSize(
          7.5
        );

        doc.setTextColor(
          ...COLORS.muted
        );

        doc.text(
          "Sin detalle de productos.",
          margin + 3,
          y
        );

        y += 5;
      }

      items.forEach(
        (item) => {
          const tipoVenta =
            getTipoVenta(
              item
            );

          const subtotal =
            getItemSubtotal(
              item
            );

          const description =
            getProductMainText(
              item
            );

          const secondary =
            getProductSecondaryText(
              item
            );

          /*
           * Dejamos espacio a la derecha
           * para el subtotal.
           */
          const textWidth =
            contentWidth -
            58;

          const descriptionLines =
            doc.splitTextToSize(
              cleanPdfText(
                description
              ),
              textWidth
            );

          const descriptionHeight =
            Math.max(
              4,
              descriptionLines.length *
                3.8
            );

          /*
           * Cada producto ocupa como mínimo
           * dos líneas: descripción + precio/tipo.
           */
          const rowHeight =
            Math.max(
              9,
              descriptionHeight +
                4
            );

          ensureSpace(
            rowHeight + 2
          );

          /* PRODUCTO */

          doc.setFont(
            "helvetica",
            "normal"
          );

          doc.setFontSize(
            8
          );

          doc.setTextColor(
            ...COLORS.dark
          );

          doc.text(
            descriptionLines,
            margin + 3,
            y
          );

          /* DETALLE */

          doc.setFont(
            "helvetica",
            "normal"
          );

          doc.setFontSize(
            7
          );

          doc.setTextColor(
            ...COLORS.muted
          );

          const secondaryY =
            y +
            descriptionHeight;

          doc.text(
            cleanPdfText(
              secondary
            ),
            margin + 3,
            secondaryY
          );

          /*
           * Etiqueta adicional para que el PDF
           * sea inequívoco al leer productos
           * especiales.
           */
          if (
            tipoVenta === "peso"
          ) {
            doc.setFontSize(
              6.5
            );

            doc.text(
              "Venta por peso",
              margin + 41,
              secondaryY
            );
          } else if (
            tipoVenta ===
            "precio-libre"
          ) {
            doc.setFontSize(
              6.5
            );

            doc.text(
              "Precio definido en la venta",
              margin + 35,
              secondaryY
            );
          }

          /* SUBTOTAL */

          doc.setFont(
            "helvetica",
            "bold"
          );

          doc.setFontSize(
            8
          );

          doc.setTextColor(
            ...COLORS.dark
          );

          doc.text(
            cleanPdfText(
              money(
                subtotal
              )
            ),
            pageWidth -
              margin -
              3,
            y,
            {
              align:
                "right",
            }
          );

          y +=
            rowHeight;

          /* LÍNEA ENTRE PRODUCTOS */

          doc.setDrawColor(
            ...COLORS.line
          );

          doc.setLineWidth(
            0.15
          );

          doc.line(
            margin + 3,
            y - 1.5,
            pageWidth -
              margin -
              3,
            y - 1.5
          );
        }
      );

      /* ---------------------------------------------------
         EFECTIVO / VUELTO
      --------------------------------------------------- */

      if (
        normalizePaymentMethod(
          sale?.payment
            ?.method
        ) === "efectivo"
      ) {
        ensureSpace(
          8
        );

        const received =
          roundMoney(
            sale?.payment
              ?.received
          );

        const change =
          roundMoney(
            sale?.payment
              ?.change
          );

        doc.setFont(
          "helvetica",
          "normal"
        );

        doc.setFontSize(
          7
        );

        doc.setTextColor(
          ...COLORS.muted
        );

        doc.text(
          cleanPdfText(
            `Recibido: ${money(
              received ||
                sale.total
            )}  |  Vuelto: ${money(
              change
            )}`
          ),
          margin + 3,
          y + 1
        );

        y += 6;
      }

      ensureSpace(
        6
      );

      doc.setDrawColor(
        ...COLORS.line
      );

      doc.setLineWidth(
        0.25
      );

      doc.line(
        margin,
        y,
        pageWidth -
          margin,
        y
      );

      y += 6;
    }
  );

  /* =======================================================
     TOTAL FINAL
  ======================================================= */

  ensureSpace(
    23
  );

  y += 2;

  doc.setFillColor(
    ...COLORS.yellow
  );

  doc.roundedRect(
    margin,
    y,
    contentWidth,
    18,
    4,
    4,
    "F"
  );

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setTextColor(
    ...COLORS.dark
  );

  doc.setFontSize(
    8
  );

  doc.text(
    "TOTAL DE VENTAS",
    margin + 5,
    y + 7
  );

  doc.setFontSize(
    16
  );

  doc.text(
    cleanPdfText(
      money(
        session.totalSales
      )
    ),
    pageWidth -
      margin -
      5,
    y + 11,
    {
      align:
        "right",
    }
  );

  /* =======================================================
     FOOTER
  ======================================================= */

  const totalPages =
    doc.getNumberOfPages();

  const generatedAt =
    formatDateTime(
      new Date()
    );

  for (
    let page = 1;
    page <= totalPages;
    page += 1
  ) {
    doc.setPage(
      page
    );

    doc.setDrawColor(
      ...COLORS.line
    );

    doc.setLineWidth(
      0.25
    );

    doc.line(
      margin,
      pageHeight - 13,
      pageWidth -
        margin,
      pageHeight - 13
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      6.5
    );

    doc.setTextColor(
      ...COLORS.muted
    );

    doc.text(
      cleanPdfText(
        `Generado ${generatedAt}`
      ),
      margin,
      pageHeight - 8
    );

    doc.text(
      `Pagina ${page} de ${totalPages}`,
      pageWidth -
        margin,
      pageHeight - 8,
      {
        align:
          "right",
      }
    );
  }

  /* =======================================================
     DESCARGAR
  ======================================================= */

  const business =
    safeFileSegment(
      shopName
    ) ||
    "mi-negocio";

  const date =
    fileDate(
      session.closeTime ||
        session.openTime
    );

  const filename =
    `${business}-cierre-caja-${date}.pdf`;

  doc.save(
    filename
  );

  return filename;
}
/* =========================================================
   PDF EXCLUSIVO DE AUDITORÍA
========================================================= */

const AUDIT_ACTION_META = {
  "apertura-caja": {
    title: "Apertura de caja",
    category: "Caja",
  },
  "venta-realizada": {
    title: "Venta realizada",
    category: "Ventas",
  },
  "migracion-ganancias-historicas": {
    title: "Ganancias históricas completadas",
    category: "Ganancias",
  },
  "alta-item-compra": {
    title: "Ítem agregado a compras",
    category: "Compras",
  },
  "compra-completada": {
    title: "Compra registrada",
    category: "Compras",
  },
  "alta-cuenta-por-pagar": {
    title: "Cuenta por pagar creada",
    category: "Cuentas por pagar",
  },
  "pago-cuenta-por-pagar": {
    title: "Pago de cuenta por pagar",
    category: "Cuentas por pagar",
  },
  "cuenta-por-pagar-saldada": {
    title: "Cuenta por pagar saldada",
    category: "Cuentas por pagar",
  },
  "reposicion-stock": {
    title: "Reposición de stock",
    category: "Inventario",
  },
  "edicion-producto": {
    title: "Edición de producto",
    category: "Inventario",
  },
  "alta-producto": {
    title: "Alta de producto",
    category: "Inventario",
  },
  "eliminacion-producto": {
    title: "Eliminación de producto",
    category: "Inventario",
  },
  "alta-cuenta-por-cobrar": {
    title: "Cuenta por cobrar creada",
    category: "Cuentas por cobrar",
  },
  "cobro-cuenta-por-cobrar": {
    title: "Cobro de cuenta",
    category: "Cuentas por cobrar",
  },
  "cuenta-por-cobrar-saldada": {
    title: "Cuenta saldada",
    category: "Cuentas por cobrar",
  },
  "cierre-caja": {
    title: "Cierre de caja",
    category: "Caja",
  },
};

function formatAuditRole(value) {
  const role =
    String(value || "")
      .trim()
      .toLowerCase();

  if (role === "administrador") {
    return "Administrador";
  }

  if (role === "encargado") {
    return "Encargado";
  }

  return role || "Operador";
}

function formatAuditPaymentMethod(value) {
  const method =
    String(value || "")
      .trim()
      .toLowerCase();

  return PAYMENT_LABELS[method] ||
    method ||
    "Sin especificar";
}

function formatAuditStock(
  value,
  tipoVenta
) {
  if (tipoVenta === "peso") {
    return `${formatQuantity(
      value
    )} kg`;
  }

  return `${Math.trunc(
    number(value)
  ).toLocaleString(
    "es-AR"
  )} u.`;
}

function formatAuditDateTime(value) {
  const date =
    parseDate(value);

  if (!date) {
    return "Fecha no disponible";
  }

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }
  )
    .format(date)
    .replace(",", "");
}

function getAuditPdfDetailRows(event) {
  const detail =
    event?.detalle &&
    typeof event.detalle === "object" &&
    !Array.isArray(event.detalle)
      ? event.detalle
      : {};

  switch (event?.accion) {
    case "apertura-caja":
      return [
        [
          "Monto inicial",
          money(
            detail.montoInicial
          ),
        ],
      ];

    case "venta-realizada":
      return [
        [
          "Venta",
          detail.ventaId
            ? `#${detail.ventaId}`
            : "Sin referencia",
        ],
        [
          "Total",
          money(detail.total),
        ],
        ...(Number.isFinite(
          Number(
            detail.costoMercaderia
          )
        )
          ? [[
              "Costo mercadería",
              money(
                detail.costoMercaderia
              ),
            ]]
          : []),
        ...(Number.isFinite(
          Number(
            detail.gananciaBruta
          )
        )
          ? [[
              "Ganancia bruta",
              money(
                detail.gananciaBruta
              ),
            ]]
          : []),
        [
          "Medio de pago",
          formatAuditPaymentMethod(
            detail.metodoPago
          ),
        ],
        ...(Array.isArray(
          detail.mediosPago
        )
          ? detail.mediosPago
              .filter(
                (part) =>
                  part &&
                  Number.isFinite(
                    Number(
                      part.importe
                    )
                  ) &&
                  Number(
                    part.importe
                  ) > 0
              )
              .map(
                (part) => [
                  formatAuditPaymentMethod(
                    part.metodo
                  ),
                  money(
                    roundMoney(
                      part.importe
                    )
                  ),
                ]
              )
          : []),
        [
          "Productos",
          String(
            Math.max(
              0,
              Math.trunc(
                number(
                  detail.cantidadItems
                )
              )
            )
          ),
        ],
      ];

    case "migracion-ganancias-historicas":
      return [
        [
          "Ventas actualizadas",
          String(
            Math.max(
              0,
              Math.trunc(
                number(
                  detail.ventasActualizadas
                )
              )
            )
          ),
        ],
        [
          "Líneas actualizadas",
          String(
            Math.max(
              0,
              Math.trunc(
                number(
                  detail.lineasActualizadas
                )
              )
            )
          ),
        ],
        [
          "Costos históricos",
          String(
            Math.max(
              0,
              Math.trunc(
                number(
                  detail.lineasMigradas
                )
              )
            )
          ),
        ],
        [
          "Costos estimados",
          String(
            Math.max(
              0,
              Math.trunc(
                number(
                  detail.lineasEstimadas
                )
              )
            )
          ),
        ],
        [
          "Costo incorporado",
          money(
            detail.costoHistoricoAgregado
          ),
        ],
        [
          "Pendientes",
          String(
            Math.max(
              0,
              Math.trunc(
                number(
                  detail.ventasPendientes
                )
              )
            )
          ),
        ],
        [
          "Resultado",
          detail.resultado === "completo"
            ? "Completo"
            : detail.resultado === "parcial"
              ? "Parcial"
              : String(
                  detail.resultado ||
                  "-"
                ),
        ],
      ];

    case "alta-item-compra":
      return [
        [
          "Concepto",
          detail.concepto || "Compra",
        ],
        [
          "Proveedor",
          detail.proveedor || "-",
        ],
        [
          "Cantidad",
          String(
            number(
              detail.cantidad
            )
          ),
        ],
        [
          "Costo estimado",
          money(
            detail.costoEstimado
          ),
        ],
      ];

    case "compra-completada":
      return [
        [
          "Concepto",
          detail.concepto || "Compra",
        ],
        [
          "Proveedor",
          detail.proveedor || "-",
        ],
        [
          "Costo real",
          money(
            detail.costoReal
          ),
        ],
        ...(detail.productoBarcode
          ? [[
              "Producto",
              detail.productoBarcode,
            ]]
          : []),
        ...(detail.cuentaPorPagarId
          ? [[
              "Cuenta por pagar",
              detail.cuentaPorPagarId,
            ]]
          : []),
      ];

    case "alta-cuenta-por-pagar":
      return [
        [
          "Proveedor / persona",
          detail.proveedorNombre || "-",
        ],
        [
          "Importe",
          money(
            detail.importeOriginal
          ),
        ],
        [
          "Concepto",
          detail.concepto || "-",
        ],
        [
          "Origen",
          detail.origen === "compra"
            ? "Compra"
            : "Alta manual",
        ],
      ];

    case "pago-cuenta-por-pagar":
      return [
        [
          "Proveedor / persona",
          detail.proveedorNombre || "-",
        ],
        [
          "Importe pagado",
          money(
            detail.importe
          ),
        ],
        [
          "Medio de pago",
          formatAuditPaymentMethod(
            detail.metodoPago
          ),
        ],
        [
          "Saldo",
          `${money(
            detail.saldoAnterior
          )} -> ${money(
            detail.saldoRestante
          )}`,
        ],
      ];

    case "cuenta-por-pagar-saldada":
      return [
        [
          "Proveedor / persona",
          detail.proveedorNombre || "-",
        ],
        [
          "Importe original",
          money(
            detail.importeOriginal
          ),
        ],
        [
          "Total pagado",
          money(
            detail.totalPagado
          ),
        ],
      ];

    case "reposicion-stock": {
      const tipoVenta =
        String(
          detail.tipoVenta ||
          "unidad"
        );

      return [
        [
          "Producto",
          detail.productoNombre ||
            "Producto",
        ],
        [
          "Cantidad agregada",
          formatAuditStock(
            detail.cantidadAgregada,
            tipoVenta
          ),
        ],
        [
          "Stock",
          `${formatAuditStock(
            detail.stockAnterior,
            tipoVenta
          )} -> ${formatAuditStock(
            detail.stockNuevo,
            tipoVenta
          )}`,
        ],
      ];
    }

    case "edicion-producto": {
      const rows = [];

      if (
        String(
          detail.nombreAnterior ||
          ""
        ) !==
        String(
          detail.nombreNuevo ||
          ""
        )
      ) {
        rows.push([
          "Nombre",
          `${detail.nombreAnterior || "-"} -> ${detail.nombreNuevo || "-"}`,
        ]);
      }

      if (
        roundMoney(
          detail.precioAnterior
        ) !==
        roundMoney(
          detail.precioNuevo
        )
      ) {
        rows.push([
          "Precio",
          `${money(
            detail.precioAnterior
          )} -> ${money(
            detail.precioNuevo
          )}`,
        ]);
      }

      if (
        roundQuantity(
          detail.stockAnterior
        ) !==
        roundQuantity(
          detail.stockNuevo
        )
      ) {
        rows.push([
          "Stock",
          `${formatQuantity(
            detail.stockAnterior
          )} -> ${formatQuantity(
            detail.stockNuevo
          )}`,
        ]);
      }

      if (
        String(
          detail.barcodeAnterior ||
          ""
        ) !==
        String(
          detail.barcodeNuevo ||
          ""
        )
      ) {
        rows.push([
          "Código",
          `${detail.barcodeAnterior || "-"} -> ${detail.barcodeNuevo || "-"}`,
        ]);
      }

      return rows.length > 0
        ? rows
        : [[
            "Producto",
            detail.nombreNuevo ||
              detail.nombreAnterior ||
              "Producto actualizado",
          ]];
    }

    case "alta-producto":
    case "eliminacion-producto": {
      const tipoVenta =
        String(
          detail.tipoVenta ||
          "unidad"
        );

      return [
        [
          "Producto",
          detail.productoNombre ||
            "Producto",
        ],
        [
          "Código",
          detail.barcode ||
            "Código interno",
        ],
        [
          "Precio",
          tipoVenta ===
          "precio-libre"
            ? "Importe libre"
            : money(
                detail.precio
              ),
        ],
        [
          "Stock",
          tipoVenta ===
          "precio-libre"
            ? "Sin control"
            : formatAuditStock(
                detail.stock,
                tipoVenta
              ),
        ],
      ];
    }

    case "alta-cuenta-por-cobrar":
      return [
        [
          "Cliente",
          detail.clienteNombre ||
            "Cliente",
        ],
        [
          "Importe",
          money(
            detail.importeOriginal
          ),
        ],
        [
          "Origen",
          detail.origen ===
          "venta"
            ? "Venta a cuenta"
            : "Alta manual",
        ],
        ...(detail.ventaId
          ? [[
              "Venta",
              `#${detail.ventaId}`,
            ]]
          : []),
      ];

    case "cobro-cuenta-por-cobrar":
      return [
        [
          "Cliente",
          detail.clienteNombre ||
            "Cliente",
        ],
        [
          "Importe",
          money(
            detail.importe
          ),
        ],
        [
          "Medio de pago",
          formatAuditPaymentMethod(
            detail.metodoPago
          ),
        ],
        [
          "Saldo",
          `${money(
            detail.saldoAnterior
          )} -> ${money(
            detail.saldoRestante
          )}`,
        ],
      ];

    case "cuenta-por-cobrar-saldada":
      return [
        [
          "Cliente",
          detail.clienteNombre ||
            "Cliente",
        ],
        [
          "Importe original",
          money(
            detail.importeOriginal
          ),
        ],
        [
          "Total pagado",
          money(
            detail.totalPagado
          ),
        ],
      ];

    case "cierre-caja":
      return [
        [
          "Efectivo esperado",
          money(
            detail.efectivoEsperado
          ),
        ],
        [
          "Efectivo contado",
          money(
            detail.efectivoContado
          ),
        ],
        [
          "Diferencia",
          formatDifference(
            detail.diferencia
          ),
        ],
        [
          "Ventas",
          money(
            detail.totalVentas
          ),
        ],
        [
          "Tickets",
          String(
            Math.max(
              0,
              Math.trunc(
                number(
                  detail.cantidadVentas
                )
              )
            )
          ),
        ],
      ];

    default:
      return Object.entries(
        detail
      )
        .filter(
          ([, value]) =>
            value !== null &&
            value !== undefined &&
            typeof value !==
              "object"
        )
        .slice(0, 10)
        .map(
          ([key, value]) => [
            key,
            String(value),
          ]
        );
  }
}

export function downloadAuditPdf({
  session,
  events = [],
  shopName = "Mi Negocio",
}) {
  if (
    !session ||
    session.status !==
      "closed"
  ) {
    throw new Error(
      "La caja debe estar cerrada para generar el PDF de auditoría."
    );
  }

  const safeEvents =
    Array.isArray(events)
      ? events
      : [];

  const sessionEvents =
    safeEvents
      .filter(
        (event) =>
          event?.sessionId ===
          session.id
      )
      .slice()
      .sort(
        (a, b) => {
          const aTime =
            parseDate(
              a?.fecha
            )?.getTime() ||
            0;

          const bTime =
            parseDate(
              b?.fecha
            )?.getTime() ||
            0;

          return aTime - bTime;
        }
      );

  if (
    sessionEvents.length === 0
  ) {
    throw new Error(
      "Este turno no tiene eventos de auditoría para exportar."
    );
  }

  const doc =
    new jsPDF({
      orientation:
        "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

  const pageWidth =
    doc.internal.pageSize.getWidth();

  const pageHeight =
    doc.internal.pageSize.getHeight();

  const margin = 14;
  const contentWidth =
    pageWidth -
    margin * 2;

  const footerTop =
    pageHeight - 15;

  let y = 0;

  function drawPageHeader(
    continuation = false
  ) {
    y = 16;

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      continuation
        ? 11
        : 16
    );

    doc.setTextColor(
      ...COLORS.dark
    );

    doc.text(
      cleanPdfText(
        continuation
          ? "Auditoría del turno - continuación"
          : "Auditoría del turno"
      ),
      margin,
      y
    );

    if (!continuation) {
      y += 7;

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(9);
      doc.setTextColor(
        ...COLORS.yellowDark
      );

      doc.text(
        cleanPdfText(
          shopName ||
          "Mi Negocio"
        ),
        margin,
        y
      );

      y += 5;

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(7.5);
      doc.setTextColor(
        ...COLORS.muted
      );

      doc.text(
        cleanPdfText(
          `${formatDateTime(
            session.openTime
          )} - ${formatDateTime(
            session.closeTime
          )}`
        ),
        margin,
        y
      );

      y += 4;

      doc.text(
        cleanPdfText(
          `Sesión: ${session.id}`
        ),
        margin,
        y
      );

      y += 5;

      doc.setFillColor(
        ...COLORS.light
      );

      doc.roundedRect(
        margin,
        y,
        contentWidth,
        13,
        2.5,
        2.5,
        "F"
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(7.2);
      doc.setTextColor(
        ...COLORS.muted
      );

      const note =
        doc.splitTextToSize(
          cleanPdfText(
            "Este documento contiene únicamente la cronología de auditoría registrada para el turno. El reporte económico de caja se descarga por separado."
          ),
          contentWidth - 8
        );

      doc.text(
        note,
        margin + 4,
        y + 5
      );

      y += 18;
    } else {
      y += 7;
    }

    doc.setDrawColor(
      ...COLORS.yellow
    );

    doc.setLineWidth(0.8);
    doc.line(
      margin,
      y,
      pageWidth - margin,
      y
    );

    y += 8;
  }

  function ensureAuditSpace(
    needed
  ) {
    if (
      y + needed <=
      footerTop
    ) {
      return;
    }

    doc.addPage();
    drawPageHeader(true);
  }

  drawPageHeader(false);

  sessionEvents.forEach(
    (event, index) => {
      const meta =
        AUDIT_ACTION_META[
          event?.accion
        ] || {
          title:
            event?.accion ||
            "Evento de auditoría",
          category:
            "Auditoría",
        };

      const rows =
        getAuditPdfDetailRows(
          event
        );

      const operatorText =
        `${event?.operadorNombre || "Operador"} - ${formatAuditRole(
          event?.operadorRol
        )}`;

      const operatorLines =
        doc.splitTextToSize(
          cleanPdfText(
            operatorText
          ),
          contentWidth - 34
        );

      const deviceText =
        event?.deviceId
          ? `Dispositivo: ${event.deviceId}`
          : "";

      const deviceLines =
        deviceText
          ? doc.splitTextToSize(
              cleanPdfText(
                deviceText
              ),
              contentWidth - 34
            )
          : [];

      const rowLayouts =
        rows.map(
          ([label, value]) => {
            const valueLines =
              doc.splitTextToSize(
                cleanPdfText(
                  value
                ),
                contentWidth - 52
              );

            return {
              label:
                cleanPdfText(
                  label
                ),
              valueLines,
              height:
                Math.max(
                  4.2,
                  valueLines.length *
                    3.5
                ),
            };
          }
        );

      const detailHeight =
        rowLayouts.reduce(
          (sum, row) =>
            sum + row.height,
          0
        );

      const cardHeight =
        22 +
        operatorLines.length * 3.3 +
        deviceLines.length * 3.2 +
        detailHeight +
        (rows.length > 0
          ? 5
          : 1);

      ensureAuditSpace(
        cardHeight + 6
      );

      doc.setFillColor(
        250,
        250,
        251
      );

      doc.setDrawColor(
        ...COLORS.line
      );

      doc.setLineWidth(0.25);

      doc.roundedRect(
        margin,
        y,
        contentWidth,
        cardHeight,
        3,
        3,
        "FD"
      );

      doc.setFillColor(
        ...COLORS.yellow
      );

      doc.roundedRect(
        margin + 4,
        y + 4,
        12,
        8,
        2,
        2,
        "F"
      );

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(7.5);
      doc.setTextColor(
        ...COLORS.dark
      );

      doc.text(
        String(
          index + 1
        ).padStart(
          2,
          "0"
        ),
        margin + 10,
        y + 9.2,
        {
          align: "center",
        }
      );

      const textX =
        margin + 20;

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(7.3);
      doc.setTextColor(
        ...COLORS.yellowDark
      );

      doc.text(
        cleanPdfText(
          `${meta.category} - ${formatAuditDateTime(
            event?.fecha
          )}`
        ),
        textX,
        y + 6.2
      );

      doc.setFontSize(10.2);
      doc.setTextColor(
        ...COLORS.dark
      );

      doc.text(
        cleanPdfText(
          meta.title
        ),
        textX,
        y + 11.3
      );

      let currentY =
        y + 16.5;

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(7.2);
      doc.setTextColor(
        ...COLORS.muted
      );

      doc.text(
        operatorLines,
        textX,
        currentY
      );

      currentY +=
        operatorLines.length *
        3.3;

      if (
        deviceLines.length > 0
      ) {
        doc.text(
          deviceLines,
          textX,
          currentY
        );

        currentY +=
          deviceLines.length *
          3.2;
      }

      if (
        rowLayouts.length > 0
      ) {
        currentY += 2;

        doc.setDrawColor(
          ...COLORS.line
        );

        doc.setLineWidth(0.15);
        doc.line(
          textX,
          currentY,
          pageWidth -
            margin -
            4,
          currentY
        );

        currentY += 4;
      }

      rowLayouts.forEach(
        (row) => {
          doc.setFont(
            "helvetica",
            "bold"
          );

          doc.setFontSize(7);
          doc.setTextColor(
            ...COLORS.muted
          );

          doc.text(
            row.label,
            textX,
            currentY
          );

          doc.setFont(
            "helvetica",
            "normal"
          );

          doc.setTextColor(
            ...COLORS.dark
          );

          doc.text(
            row.valueLines,
            textX + 32,
            currentY
          );

          currentY +=
            row.height;
        }
      );

      y +=
        cardHeight + 5;
    }
  );

  const totalPages =
    doc.getNumberOfPages();

  const generatedAt =
    formatDateTime(
      new Date()
    );

  for (
    let page = 1;
    page <= totalPages;
    page += 1
  ) {
    doc.setPage(page);

    doc.setDrawColor(
      ...COLORS.line
    );

    doc.setLineWidth(0.25);
    doc.line(
      margin,
      pageHeight - 13,
      pageWidth - margin,
      pageHeight - 13
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(6.5);
    doc.setTextColor(
      ...COLORS.muted
    );

    doc.text(
      cleanPdfText(
        `Generado ${generatedAt}`
      ),
      margin,
      pageHeight - 8
    );

    doc.text(
      `Pagina ${page} de ${totalPages}`,
      pageWidth - margin,
      pageHeight - 8,
      {
        align: "right",
      }
    );
  }

  const business =
    safeFileSegment(
      shopName
    ) ||
    "mi-negocio";

  const date =
    fileDate(
      session.closeTime ||
      session.openTime
    );

  const filename =
    `${business}-auditoria-turno-${date}.pdf`;

  doc.save(filename);

  return filename;
}
