// src/lib/saleTicket.js
// Utilidades de ticket interno: impresión térmica, descarga PDF y compartir.
// No depende de librerías externas y no genera comprobantes fiscales.

const MONEY_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const TICKET_WIDTHS = {
  58: {
    widthMm: 58,
    columns: 32,
    fontSize: 7.2,
    lineHeight: 9.1,
    marginPt: 12,
  },
  80: {
    widthMm: 80,
    columns: 44,
    fontSize: 8,
    lineHeight: 10.2,
    marginPt: 14,
  },
};

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundQuantity(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 1000) / 1000;
}

function formatMoney(value) {
  return MONEY_FORMATTER.format(toNumber(value));
}

function formatQuantity(value) {
  return roundQuantity(value).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? DATE_FORMATTER.format(new Date()) : DATE_FORMATTER.format(date);
}

function formatDateOnly(value) {
  const raw = cleanText(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);

  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime())
    ? DATE_ONLY_FORMATTER.format(new Date())
    : DATE_ONLY_FORMATTER.format(date);
}

function normalizeWidth(width) {
  return Number(width) === 80 ? 80 : 58;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function repeat(char, length) {
  return char.repeat(Math.max(0, length));
}

function center(text, columns) {
  const value = cleanText(text).slice(0, columns);
  const left = Math.max(0, Math.floor((columns - value.length) / 2));
  return `${repeat(" ", left)}${value}`;
}

function pair(left, right, columns) {
  const leftText = cleanText(left);
  const rightText = cleanText(right);

  if (!rightText) {
    return leftText.slice(0, columns);
  }

  if (rightText.length >= columns) {
    return rightText.slice(-columns);
  }

  const maxLeft = Math.max(0, columns - rightText.length - 1);
  const clippedLeft = leftText.slice(0, maxLeft);
  const gap = Math.max(1, columns - clippedLeft.length - rightText.length);

  return `${clippedLeft}${repeat(" ", gap)}${rightText}`;
}

function wrapText(text, columns) {
  const value = cleanText(text);

  if (!value) {
    return [""];
  }

  const words = value.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    if (word.length > columns) {
      if (current) {
        lines.push(current);
        current = "";
      }

      for (let index = 0; index < word.length; index += columns) {
        lines.push(word.slice(index, index + columns));
      }

      continue;
    }

    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= columns) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function paymentLabel(method) {
  const labels = {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    qr: "QR",
    tarjeta: "Tarjeta",
    cuenta: "A cuenta",
    mixto: "Pago combinado",
  };

  return labels[method] || cleanText(method) || "Sin informar";
}

function getItemSubtotal(item) {
  const baseStored = Number(item?.baseSubtotal);

  if (Number.isFinite(baseStored)) {
    return baseStored;
  }

  const stored = Number(item?.subtotal);

  if (Number.isFinite(stored)) {
    return stored;
  }

  return toNumber(item?.qty, 1) * toNumber(item?.price);
}

function getTicketId(ticket) {
  const id = cleanText(ticket?.sale?.id || ticket?.id || "");
  return id || `local-${Date.now()}`;
}

export function getDisplayTicketId(ticket) {
  const raw = getTicketId(ticket).replace(/[^a-zA-Z0-9]/g, "");
  const tail = raw.slice(-8).toUpperCase();
  return `T-${tail || String(Date.now()).slice(-8)}`;
}

export function ticketFileName(ticket) {
  const id = getTicketId(ticket)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(-12);

  const prefix =
    ticket?.kind === "receivable-payment"
      ? "cobro"
      : ticket?.kind === "receivable-debt"
        ? "deuda"
        : "ticket";

  return `${prefix}-${id || "venta"}.pdf`;
}

export function createSaleTicketPayload({
  sale,
  shopName = "Mi Negocio",
  operatorName = "",
  config = {},
} = {}) {
  const ticketConfig = config && typeof config === "object" ? config : {};
  const saleData = sale && typeof sale === "object" ? sale : {};
  const saleOperatorName = cleanText(
    saleData?.operador?.nombre ||
      saleData?.operador?.operadorNombre ||
      saleData?.operatorName ||
      saleData?.operadorNombre ||
      operatorName
  );

  return {
    sale: saleData,
    shopName:
      cleanText(ticketConfig.businessName) ||
      cleanText(shopName) ||
      "Mi Negocio",
    address: cleanText(ticketConfig.address),
    phone: cleanText(ticketConfig.phone),
    footerText: cleanText(ticketConfig.footerText),
    operatorName: saleOperatorName,
    defaultWidth: Number(ticketConfig.defaultWidth) === 80 ? 80 : 58,
  };
}

export function createReceivablePaymentTicketPayload({
  receipt,
  shopName = "Mi Negocio",
  config = {},
} = {}) {
  const ticketConfig = config && typeof config === "object" ? config : {};
  const data = receipt && typeof receipt === "object" ? receipt : {};

  return {
    kind: "receivable-payment",
    id: cleanText(data.pagoId || data.id || `cobro-${Date.now()}`),
    shopName:
      cleanText(ticketConfig.businessName) ||
      cleanText(shopName) ||
      "Mi Negocio",
    address: cleanText(ticketConfig.address),
    phone: cleanText(ticketConfig.phone),
    footerText: cleanText(ticketConfig.footerText),
    operatorName: cleanText(data.operadorNombre),
    customerName: cleanText(data.clienteNombre),
    customerPhone: cleanText(data.clienteTelefono),
    payment: {
      method: cleanText(data.metodoPago),
      amount: toNumber(data.importe),
      received: toNumber(data.efectivoRecibido),
      change: toNumber(data.vuelto),
    },
    previousBalance: toNumber(data.saldoAnterior),
    remainingBalance: toNumber(data.saldoRestante),
    originalAmount: toNumber(data.importeOriginal),
    totalPaid: toNumber(data.totalPagado),
    concept: cleanText(data.concepto),
    timestamp: data.fecha || new Date().toISOString(),
    settled: data.estado === "pagado" || toNumber(data.saldoRestante) <= 0,
    defaultWidth: Number(ticketConfig.defaultWidth) === 80 ? 80 : 58,
  };
}

export function createReceivableDebtTicketPayload({
  account,
  shopName = "Mi Negocio",
  config = {},
} = {}) {
  const ticketConfig = config && typeof config === "object" ? config : {};
  const data = account && typeof account === "object" ? account : {};

  return {
    kind: "receivable-debt",
    id: cleanText(data.id || data.ventaId || `deuda-${Date.now()}`),
    shopName:
      cleanText(ticketConfig.businessName) ||
      cleanText(shopName) ||
      "Mi Negocio",
    address: cleanText(ticketConfig.address),
    phone: cleanText(ticketConfig.phone),
    footerText: cleanText(ticketConfig.footerText),
    customerName: cleanText(data.clienteNombre),
    customerPhone: cleanText(data.clienteTelefono),
    remainingBalance: toNumber(data.saldoPendiente),
    generatedAt: new Date().toISOString(),
    defaultWidth: Number(ticketConfig.defaultWidth) === 80 ? 80 : 58,
  };
}

function buildReceivableDebtLines(ticket, width = 58) {
  const normalizedWidth = normalizeWidth(width);
  const columns = TICKET_WIDTHS[normalizedWidth].columns;
  const separator = repeat("-", columns);
  const lines = [];
  const shopName = cleanText(ticket?.shopName || "Mi Negocio");
  const address = cleanText(ticket?.address);
  const phone = cleanText(ticket?.phone);
  const footerText = cleanText(ticket?.footerText);

  lines.push(center(shopName.toUpperCase(), columns));

  if (address) {
    lines.push(
      ...wrapText(address, columns)
        .map((line) => center(line, columns))
    );
  }

  if (phone) {
    lines.push(center(`Tel: ${phone}`, columns));
  }

  lines.push(center("COMPROBANTE DE DEUDA", columns));
  lines.push(center("NO FISCAL", columns));
  lines.push(separator);
  lines.push(pair("Cuenta", getDisplayTicketId(ticket), columns));
  lines.push(pair("Emitido", formatDate(ticket?.generatedAt), columns));

  lines.push(
    ...wrapText(
      `Cliente: ${cleanText(ticket?.customerName) || "Sin informar"}`,
      columns
    )
  );

  if (ticket?.customerPhone) {
    lines.push(
      ...wrapText(`Tel. cliente: ${ticket.customerPhone}`, columns)
    );
  }

  lines.push(separator);
  lines.push(
    pair("SALDO PENDIENTE", formatMoney(ticket?.remainingBalance), columns)
  );
  lines.push(separator);
  lines.push(
    ...wrapText(
      "Saldo pendiente al momento de emitir este comprobante.",
      columns
    ).map((line) => center(line, columns))
  );

  if (footerText) {
    lines.push(
      ...wrapText(footerText, columns)
        .map((line) => center(line, columns))
    );
  }

  lines.push(center("Comprobante interno - no fiscal", columns));

  return lines;
}

function buildReceivablePaymentLines(ticket, width = 58) {
  const normalizedWidth = normalizeWidth(width);
  const columns = TICKET_WIDTHS[normalizedWidth].columns;
  const separator = repeat("-", columns);
  const lines = [];
  const shopName = cleanText(ticket?.shopName || "Mi Negocio");
  const address = cleanText(ticket?.address);
  const phone = cleanText(ticket?.phone);
  const footerText = cleanText(ticket?.footerText);
  const payment = ticket?.payment || {};
  const settled =
    ticket?.settled === true ||
    toNumber(ticket?.remainingBalance) <= 0;

  lines.push(center(shopName.toUpperCase(), columns));

  if (address) {
    lines.push(
      ...wrapText(address, columns)
        .map((line) => center(line, columns))
    );
  }

  if (phone) {
    lines.push(center(`Tel: ${phone}`, columns));
  }

  lines.push(center("COMPROBANTE DE COBRO", columns));
  lines.push(center("NO FISCAL", columns));
  lines.push(separator);
  lines.push(pair("Cobro", getDisplayTicketId(ticket), columns));
  lines.push(pair("Fecha", formatDate(ticket?.timestamp), columns));

  if (ticket?.operatorName) {
    lines.push(pair("Operador", ticket.operatorName, columns));
  }

  lines.push(
    ...wrapText(
      `Cliente: ${cleanText(ticket?.customerName) || "Sin informar"}`,
      columns
    )
  );

  if (ticket?.customerPhone) {
    lines.push(
      ...wrapText(`Tel. cliente: ${ticket.customerPhone}`, columns)
    );
  }

  if (ticket?.concept) {
    lines.push(
      ...wrapText(`Concepto: ${ticket.concept}`, columns)
    );
  }

  lines.push(separator);
  lines.push(
    pair("Saldo anterior", formatMoney(ticket?.previousBalance), columns)
  );
  lines.push(
    pair("Importe abonado", formatMoney(payment?.amount), columns)
  );
  lines.push(
    pair("Saldo restante", formatMoney(ticket?.remainingBalance), columns)
  );

  if (settled) {
    lines.push(center("CUENTA SALDADA", columns));
  }

  lines.push(separator);
  lines.push(
    pair("Forma de pago", paymentLabel(payment?.method), columns)
  );

  if (payment?.method === "efectivo") {
    lines.push(
      pair("Recibido", formatMoney(payment?.received), columns)
    );
    lines.push(
      pair("Vuelto", formatMoney(payment?.change), columns)
    );
  }

  lines.push(separator);

  if (settled) {
    lines.push(center("Saldo cancelado correctamente", columns));
  } else {
    lines.push(center("Pago aplicado a cuenta corriente", columns));
  }

  if (footerText) {
    lines.push(
      ...wrapText(footerText, columns)
        .map((line) => center(line, columns))
    );
  }

  lines.push(center("Comprobante interno - no fiscal", columns));

  return lines;
}

export function buildTicketLines(ticket, width = 58) {
  if (ticket?.kind === "receivable-payment") {
    return buildReceivablePaymentLines(ticket, width);
  }

  if (ticket?.kind === "receivable-debt") {
    return buildReceivableDebtLines(ticket, width);
  }

  const normalizedWidth = normalizeWidth(width);
  const columns = TICKET_WIDTHS[normalizedWidth].columns;
  const sale = ticket?.sale || ticket || {};
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const payment = sale?.payment || ticket?.payment || {};
  const shopName = cleanText(ticket?.shopName || sale?.shopName || "Mi Negocio");
  const address = cleanText(ticket?.address || sale?.address || "");
  const phone = cleanText(ticket?.phone || sale?.phone || "");
  const footerText = cleanText(ticket?.footerText || sale?.footerText || "");
  const operatorName = cleanText(
    ticket?.operatorName ||
      sale?.operatorName ||
      sale?.operador?.nombre ||
      sale?.operador?.operadorNombre ||
      sale?.operadorNombre ||
      ""
  );
  const customerName = cleanText(
    payment?.receivable?.clienteNombre || ticket?.customerName || ""
  );
  const customerPhone = cleanText(
    payment?.receivable?.clienteTelefono || ticket?.customerPhone || ""
  );
  const receivableDueDate = cleanText(payment?.receivable?.vencimiento || "");
  const total = toNumber(sale?.total);
  const discount = Math.max(0, toNumber(sale?.promotionDiscountTotal));
  const shortId = getDisplayTicketId(ticket);
  const separator = repeat("-", columns);
  const lines = [];

  lines.push(center(shopName.toUpperCase(), columns));

  if (address) {
    lines.push(...wrapText(address, columns).map((line) => center(line, columns)));
  }

  if (phone) {
    lines.push(center(`Tel: ${phone}`, columns));
  }

  lines.push(center("TICKET NO FISCAL", columns));
  lines.push(separator);
  lines.push(pair("Venta", shortId, columns));
  lines.push(pair("Fecha", formatDate(sale?.timestamp), columns));

  if (operatorName) {
    lines.push(pair("Operador", operatorName, columns));
  }

  lines.push(...wrapText(`Cliente: ${customerName || "Consumidor final"}`, columns));

  if (customerPhone) {
    lines.push(...wrapText(`Tel. cliente: ${customerPhone}`, columns));
  }

  if (receivableDueDate) {
    lines.push(pair("Vencimiento", receivableDueDate, columns));
  }

  lines.push(separator);

  for (const item of items) {
    const nameLines = wrapText(item?.name || "Producto", columns);
    lines.push(...nameLines);

    const tipoVenta = cleanText(item?.tipoVenta || "unidad");
    const qty = toNumber(item?.qty, 1);
    const price = formatMoney(item?.price);
    const subtotal = formatMoney(getItemSubtotal(item));

    if (tipoVenta === "precio-libre") {
      lines.push(pair("Importe libre", subtotal, columns));
    } else {
      const unitLabel =
        tipoVenta === "peso"
          ? `${formatQuantity(qty)} ${cleanText(item?.unidadMedida || "kg")}`
          : `${formatQuantity(qty)} u`;

      lines.push(pair(`${unitLabel} x ${price}`, subtotal, columns));
    }

    if (toNumber(item?.promotionDiscount) > 0) {
      lines.push(pair("  Promo", `-${formatMoney(item.promotionDiscount)}`, columns));
    }
  }

  lines.push(separator);

  if (discount > 0) {
    lines.push(pair("Descuentos", `-${formatMoney(discount)}`, columns));
  }

  lines.push(pair("TOTAL", formatMoney(total), columns));
  lines.push(separator);

  if (payment?.method === "mixto" && Array.isArray(payment?.parts)) {
    lines.push("Pago combinado:");

    for (const part of payment.parts) {
      lines.push(
        pair(`  ${paymentLabel(part?.method)}`, formatMoney(part?.amount), columns)
      );
    }
  } else {
    lines.push(pair("Forma de pago", paymentLabel(payment?.method), columns));
  }

  if (payment?.method === "efectivo") {
    lines.push(pair("Recibido", formatMoney(payment?.received), columns));
    lines.push(pair("Vuelto", formatMoney(payment?.change), columns));
  } else if (payment?.method === "mixto" && toNumber(payment?.change) > 0) {
    lines.push(pair("Vuelto", formatMoney(payment?.change), columns));
  } else if (payment?.method === "cuenta") {
    lines.push(pair("Saldo pendiente", formatMoney(total), columns));
  }

  lines.push(separator);
  lines.push(center("Gracias por tu compra", columns));

  if (footerText) {
    lines.push(...wrapText(footerText, columns).map((line) => center(line, columns)));
  }

  lines.push(center("Comprobante interno - no fiscal", columns));

  return lines;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildPrintableTicketHtml(ticket, width = 58) {
  const normalizedWidth = normalizeWidth(width);
  const lines = buildTicketLines(ticket, normalizedWidth);
  const fontSize = normalizedWidth === 80 ? 12 : 11;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Ticket</title>
  <style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: ${normalizedWidth}mm;
      background: #fff;
      color: #000;
      font-family: "Courier New", Courier, monospace;
    }
    body { padding: 4mm 3.2mm 6mm; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 700 ${fontSize}px/1.34 "Courier New", Courier, monospace;
    }
    @media print {
      html, body { width: ${normalizedWidth}mm; }
      body { padding: 3mm 2.8mm 5mm; }
    }
  </style>
</head>
<body>
  <pre>${escapeHtml(lines.join("\n"))}</pre>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 120);
    });
  <\/script>
</body>
</html>`;
}

export function printTicket(ticket, width = 58) {
  if (typeof window === "undefined") {
    return false;
  }

  const printWindow = window.open("", "_blank", "width=460,height=760");

  if (!printWindow) {
    throw new Error("El navegador bloqueó la ventana de impresión.");
  }

  printWindow.document.open();
  printWindow.document.write(buildPrintableTicketHtml(ticket, width));
  printWindow.document.close();
  return true;
}

function toWinAnsiByte(char) {
  const code = char.codePointAt(0);

  if (code <= 0x7f) {
    return code;
  }

  if (code >= 0xa0 && code <= 0xff) {
    return code;
  }

  const map = {
    "€": 0x80,
    "‚": 0x82,
    "ƒ": 0x83,
    "„": 0x84,
    "…": 0x85,
    "†": 0x86,
    "‡": 0x87,
    "ˆ": 0x88,
    "‰": 0x89,
    "Š": 0x8a,
    "‹": 0x8b,
    "Œ": 0x8c,
    "Ž": 0x8e,
    "‘": 0x91,
    "’": 0x92,
    "“": 0x93,
    "”": 0x94,
    "•": 0x95,
    "–": 0x96,
    "—": 0x97,
    "˜": 0x98,
    "™": 0x99,
    "š": 0x9a,
    "›": 0x9b,
    "œ": 0x9c,
    "ž": 0x9e,
    "Ÿ": 0x9f,
  };

  return map[char] ?? 0x3f;
}

function encodeWinAnsi(value) {
  const bytes = [];

  for (const char of String(value)) {
    bytes.push(toWinAnsiByte(char));
  }

  return bytes;
}

function bytesToBinaryString(bytes) {
  let output = "";

  for (const byte of bytes) {
    output += String.fromCharCode(byte);
  }

  return output;
}

function pdfEscapeLiteral(value) {
  const bytes = encodeWinAnsi(value);
  const escaped = [];

  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      escaped.push(0x5c, byte);
    } else if (byte === 0x0a || byte === 0x0d) {
      escaped.push(0x20);
    } else {
      escaped.push(byte);
    }
  }

  return bytesToBinaryString(escaped);
}

function binaryStringToBytes(value) {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }

  return bytes;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

export function createTicketPdfBlob(ticket, width = 58) {
  const normalizedWidth = normalizeWidth(width);
  const config = TICKET_WIDTHS[normalizedWidth];
  const lines = buildTicketLines(ticket, normalizedWidth);
  const widthPt = (config.widthMm * 72) / 25.4;
  const contentHeight =
    config.marginPt * 2 + Math.max(1, lines.length) * config.lineHeight + 8;
  const heightPt = Math.max((34 * 72) / 25.4, contentHeight);
  const startY = heightPt - config.marginPt - config.fontSize;

  const textCommands = [
    "BT",
    `/F1 ${config.fontSize.toFixed(2)} Tf`,
    `${config.lineHeight.toFixed(2)} TL`,
    `${config.marginPt.toFixed(2)} ${startY.toFixed(2)} Td`,
  ];

  lines.forEach((line, index) => {
    if (index > 0) {
      textCommands.push("T*");
    }
    textCommands.push(`(${pdfEscapeLiteral(line)}) Tj`);
  });

  textCommands.push("ET");
  const stream = `${textCommands.join("\n")}\n`;
  const streamBytes = binaryStringToBytes(stream);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ];

  const header = binaryStringToBytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const parts = [header];
  const offsets = [0];
  let currentOffset = header.length;

  objects.forEach((object, index) => {
    offsets[index + 1] = currentOffset;
    const bytes = binaryStringToBytes(`${index + 1} 0 obj\n${object}\nendobj\n`);
    parts.push(bytes);
    currentOffset += bytes.length;
  });

  const xrefOffset = currentOffset;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";

  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  parts.push(binaryStringToBytes(trailer));

  return new Blob([concatBytes(parts)], {
    type: "application/pdf",
  });
}

export function downloadTicketPdf(ticket, width = 58) {
  if (typeof document === "undefined") {
    return false;
  }

  const blob = createTicketPdfBlob(ticket, width);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ticketFileName(ticket);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);

  return true;
}

export async function shareTicketPdf(ticket, width = 58) {
  if (
    typeof navigator === "undefined" ||
    typeof File !== "function"
  ) {
    return { shared: false, reason: "unsupported" };
  }

  const blob = createTicketPdfBlob(ticket, width);
  const file = new File([blob], ticketFileName(ticket), {
    type: "application/pdf",
  });

  let canShareFiles =
    typeof navigator.share === "function";

  if (
    canShareFiles &&
    typeof navigator.canShare === "function"
  ) {
    try {
      canShareFiles = navigator.canShare({
        files: [file],
      });
    } catch {
      canShareFiles = false;
    }
  }

  if (!canShareFiles) {
    return { shared: false, reason: "unsupported", blob };
  }

  try {
    await navigator.share({
      title: "Ticket de compra",
      text: "Te comparto el ticket de tu compra.",
      files: [file],
    });

    return { shared: true };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { shared: false, reason: "cancelled" };
    }

    throw error;
  }
}
