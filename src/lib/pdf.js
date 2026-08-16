// src/lib/pdf.js
// Generación de reportes PDF de cierres de caja.
//
// El PDF se genera completamente en el navegador.
// No se envían datos a ningún servidor externo.

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
};

const PAYMENT_ORDER = [
    "efectivo",
    "transferencia",
    "qr",
    "tarjeta",
];

/* =========================================================
   HELPERS
========================================================= */

function number(value) {
    const result = Number(value);

    return Number.isFinite(result)
        ? result
        : 0;
}

function cleanPdfText(value) {
    return String(value ?? "")
        .replace(/[–—−]/g, "-")
        .replace(/\u00A0/g, " ")
        .replace(
            /[^\x20-\x7E\u00A0-\u00FF]/g,
            "?"
        );
}

function safeFileSegment(value) {
    return String(value || "mi-negocio")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 40);
}

function parseDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);

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
    const date = parseDate(value);

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
        .replace(",", "");
}

function formatTime(value) {
    const date = parseDate(value);

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
            date.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            date.getDate()
        ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function formatDifference(value) {
    const diff =
        number(value);

    if (diff > 0) {
        return `+ ${money(diff)}`;
    }

    if (diff < 0) {
        return `- ${money(
            Math.abs(diff)
        )}`;
    }

    return money(0);
}

function paymentLabel(method) {
    return (
        PAYMENT_LABELS[
        method
        ] ||
        "Otro"
    );
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
    };

    /*
     * Preferimos los totales almacenados al cerrar la caja.
     */
    if (
        session?.paymentTotals &&
        typeof session.paymentTotals ===
        "object"
    ) {
        PAYMENT_ORDER.forEach(
            (method) => {
                totals[method] =
                    number(
                        session
                            .paymentTotals[
                        method
                        ]
                    );
            }
        );

        return totals;
    }

    /*
     * Compatibilidad con cierres antiguos.
     */
    sales.forEach((sale) => {
        const method =
            sale.payment?.method ||
            "efectivo";

        if (
            totals[method] ===
            undefined
        ) {
            return;
        }

        totals[method] +=
            number(sale.total);
    });

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
        session.status !== "closed"
    ) {
        throw new Error(
            "La caja debe estar cerrada para generar el PDF."
        );
    }

    const sessionSales = sales
        .filter(
            (sale) =>
                sale.sessionId ===
                session.id
        )
        .slice()
        .sort((a, b) => {
            const dateA =
                parseDate(
                    a.timestamp
                )?.getTime() || 0;

            const dateB =
                parseDate(
                    b.timestamp
                )?.getTime() || 0;

            return dateA - dateB;
        });

    const paymentTotals =
        getPaymentTotals(
            session,
            sessionSales
        );

    const doc = new jsPDF({
        orientation: "portrait",
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
        pageHeight - 20;

    let y = 14;

    /* =======================================================
       HELPERS DEL DOCUMENTO
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

        doc.setFontSize(9);

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

        doc.setFontSize(8);

        doc.text(
            "Cierre de caja - continuacion",
            pageWidth - margin,
            17,
            {
                align: "right",
            }
        );

        y = 24;
    }

    function ensureSpace(
        requiredHeight = 10
    ) {
        if (
            y + requiredHeight >
            bottomLimit
        ) {
            doc.addPage();

            continuationHeader();
        }
    }

    function sectionTitle(title) {
        ensureSpace(12);

        doc.setTextColor(
            ...COLORS.yellowDark
        );

        doc.setFont(
            "helvetica",
            "bold"
        );

        doc.setFontSize(9);

        doc.text(
            cleanPdfText(
                title.toUpperCase()
            ),
            margin,
            y
        );

        y += 3;

        doc.setDrawColor(
            ...COLORS.line
        );

        doc.setLineWidth(0.3);

        doc.line(
            margin,
            y,
            pageWidth -
            margin,
            y
        );

        y += 6;
    }

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

        doc.setFontSize(6.8);

        doc.setTextColor(
            ...COLORS.muted
        );

        doc.text(
            cleanPdfText(
                label.toUpperCase()
            ),
            x + 3,
            top + 5
        );

        doc.setFontSize(10);

        if (danger) {
            doc.setTextColor(
                ...COLORS.red
            );
        } else if (success) {
            doc.setTextColor(
                ...COLORS.green
            );
        } else if (highlight) {
            doc.setTextColor(
                ...COLORS.yellowDark
            );
        } else {
            doc.setTextColor(
                ...COLORS.dark
            );
        }

        doc.text(
            cleanPdfText(value),
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

    doc.setFontSize(8);

    doc.text(
        "PUNTO DE VENTA",
        margin + 9,
        y + 9
    );

    doc.setTextColor(
        ...COLORS.white
    );

    doc.setFontSize(18);

    doc.text(
        cleanPdfText(
            shopName
        ),
        margin + 9,
        y + 18
    );

    doc.setFontSize(11);

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

    doc.setFontSize(7.5);

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
            align: "right",
        }
    );

    y += 44;

    /* =======================================================
       DATOS DEL TURNO
    ======================================================= */

    sectionTitle(
        "Datos del turno"
    );

    doc.setFontSize(9);

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

    doc.setFontSize(7);

    doc.text(
        cleanPdfText(
            session.id || "-"
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
        (contentWidth - gap) /
        2;

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

    statBox(
        "Efectivo esperado",
        money(
            session.expectedAmount
        ),
        margin +
        boxWidth +
        gap,
        y,
        boxWidth
    );

    y += 19;

    statBox(
        "Efectivo contado",
        money(
            session.counted
        ),
        margin,
        y,
        boxWidth
    );

    const diff =
        number(
            session.diff
        );

    statBox(
        "Diferencia",
        formatDifference(diff),
        margin +
        boxWidth +
        gap,
        y,
        boxWidth,
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
                (boxWidth +
                    gap);

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

    y += 42;

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

        doc.setFontSize(9);

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
            ensureSpace(18);

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

            doc.setFontSize(8.5);

            doc.setTextColor(
                ...COLORS.dark
            );

            doc.text(
                `Venta #${saleIndex + 1
                }`,
                margin + 3,
                y + 5
            );

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
                    `${formatTime(
                        sale.timestamp
                    )} - ${paymentLabel(
                        sale.payment
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

            doc.setFontSize(10);

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

            /* ---------------------------------------------------
               PRODUCTOS
            --------------------------------------------------- */

            const items =
                Array.isArray(
                    sale.items
                )
                    ? sale.items
                    : [];

            if (
                items.length ===
                0
            ) {
                ensureSpace(7);

                doc.setFont(
                    "helvetica",
                    "italic"
                );

                doc.setFontSize(7.5);

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
                    const qty =
                        number(
                            item.qty
                        );

                    const price =
                        number(
                            item.price
                        );

                    const subtotal =
                        qty * price;

                    const description =
                        `${qty} x ${item.name ||
                        "Producto"
                        }`;

                    const lines =
                        doc.splitTextToSize(
                            cleanPdfText(
                                description
                            ),
                            contentWidth -
                            55
                        );

                    const height =
                        Math.max(
                            5,
                            lines.length *
                            4
                        );

                    ensureSpace(
                        height + 2
                    );

                    doc.setFont(
                        "helvetica",
                        "normal"
                    );

                    doc.setFontSize(8);

                    doc.setTextColor(
                        ...COLORS.dark
                    );

                    doc.text(
                        lines,
                        margin + 3,
                        y
                    );

                    doc.setFontSize(
                        7
                    );

                    doc.setTextColor(
                        ...COLORS.muted
                    );

                    doc.text(
                        cleanPdfText(
                            `${money(
                                price
                            )} c/u`
                        ),
                        pageWidth -
                        margin -
                        32,
                        y,
                        {
                            align:
                                "right",
                        }
                    );

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

                    y += height;
                }
            );

            /* ---------------------------------------------------
               EFECTIVO / VUELTO
            --------------------------------------------------- */

            if (
                sale.payment
                    ?.method ===
                "efectivo"
            ) {
                ensureSpace(7);

                doc.setFont(
                    "helvetica",
                    "normal"
                );

                doc.setFontSize(7);

                doc.setTextColor(
                    ...COLORS.muted
                );

                doc.text(
                    cleanPdfText(
                        `Recibido: ${money(
                            sale.payment
                                ?.received
                        )}   |   Vuelto: ${money(
                            sale.payment
                                ?.change
                        )}`
                    ),
                    margin + 3,
                    y
                );

                y += 5;
            }

            ensureSpace(6);

            doc.setDrawColor(
                ...COLORS.line
            );

            doc.setLineWidth(0.2);

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

    ensureSpace(23);

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

    doc.setFontSize(8);

    doc.text(
        "TOTAL DE VENTAS",
        margin + 5,
        y + 7
    );

    doc.setFontSize(16);

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
            align: "right",
        }
    );

    /* =======================================================
       FOOTER / NÚMERO DE PÁGINA
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

    /* =======================================================
       DESCARGAR
    ======================================================= */

    const business =
        safeFileSegment(
            shopName
        ) || "mi-negocio";

    const date =
        fileDate(
            session.closeTime ||
            session.openTime
        );

    const filename =
        `${business}-cierre-caja-${date}.pdf`;

    doc.save(filename);

    return filename;
}