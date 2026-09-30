import PDFDocument from 'pdfkit';
import { round2 } from '../utils.js';

const BILLING_LABEL = { unico: 'Pago único', mensual: 'Mensual', anual: 'Anual' };

/** Calcula importes de cada partida y totales de la cotización. */
export function computeQuote(items) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let recurringTotal = 0;
  const lines = items.map((it, i) => {
    const quantity = Number(it.quantity) || 0;
    const unitPrice = Number(it.unit_price) || 0;
    const discountPct = Math.min(Math.max(Number(it.discount_pct) || 0, 0), 100);
    const taxRate = it.tax_rate === undefined || it.tax_rate === null ? 0.16 : Number(it.tax_rate);
    const gross = quantity * unitPrice;
    const discount = gross * (discountPct / 100);
    const lineSubtotal = round2(gross - discount);
    const tax = lineSubtotal * taxRate;
    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    const lineTotal = round2(lineSubtotal + tax);
    if (it.billing && it.billing !== 'unico') recurringTotal += lineTotal;
    return {
      product_id: it.product_id || null,
      description: String(it.description || '').trim() || 'Concepto',
      quantity,
      unit_price: unitPrice,
      discount_pct: discountPct,
      tax_rate: taxRate,
      billing: it.billing || 'unico',
      line_subtotal: lineSubtotal,
      line_total: lineTotal,
      position: i,
    };
  });
  subtotal = round2(subtotal);
  discountTotal = round2(discountTotal);
  taxTotal = round2(taxTotal);
  return {
    lines,
    subtotal,
    discount_total: discountTotal,
    tax_total: taxTotal,
    total: round2(subtotal - discountTotal + taxTotal),
    recurring_total: round2(recurringTotal),
  };
}

export function money(n, currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(Number(n) || 0);
}

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d.length === 10 ? d + 'T12:00:00' : d);
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Genera el PDF de la cotización y regresa un Buffer. */
export function renderQuotePdf({ quote, items, contact, settings, seller }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = '#0B3D91';
    const gray = '#555555';
    const cur = quote.currency || 'MXN';
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Encabezado
    doc.rect(0, 0, doc.page.width, 90).fill(brand);
    doc.fillColor('#FFFFFF').fontSize(24).font('Helvetica-Bold').text(settings.company_name || 'SecureFleet', left, 28);
    doc.fontSize(9).font('Helvetica').text('Rastreo satelital y administración de flotillas', left, 58);
    doc.fontSize(18).font('Helvetica-Bold').text('COTIZACIÓN', left, 26, { width, align: 'right' });
    doc.fontSize(10).font('Helvetica').text(quote.folio, left, 50, { width, align: 'right' });

    // Datos de empresa y cliente
    let y = 110;
    doc.fillColor(gray).fontSize(8.5).font('Helvetica');
    const companyLines = [
      settings.company_legal_name,
      settings.company_rfc && `RFC: ${settings.company_rfc}`,
      settings.company_address,
      [settings.company_phone, settings.company_email].filter(Boolean).join(' · '),
      settings.company_website,
    ].filter(Boolean);
    doc.text(companyLines.join('\n'), left, y, { width: width / 2 - 10 });

    doc.fillColor('#000').font('Helvetica-Bold').fontSize(9).text('Fecha:', left + width / 2, y, { continued: true })
      .font('Helvetica').text(`  ${fmtDate(quote.issue_date)}`);
    doc.font('Helvetica-Bold').text('Vigencia:', left + width / 2, doc.y, { continued: true })
      .font('Helvetica').text(`  ${fmtDate(quote.valid_until)}`);
    if (seller) {
      doc.font('Helvetica-Bold').text('Asesor:', left + width / 2, doc.y, { continued: true })
        .font('Helvetica').text(`  ${seller.name}${seller.email ? ' · ' + seller.email : ''}`);
    }

    y = Math.max(doc.y, 110 + companyLines.length * 11) + 16;
    doc.roundedRect(left, y, width, 58, 4).fill('#F2F5FB');
    doc.fillColor(brand).font('Helvetica-Bold').fontSize(9).text('PREPARADA PARA', left + 12, y + 8);
    doc.fillColor('#000').fontSize(11).text(contact.company || contact.name, left + 12, y + 21);
    doc.font('Helvetica').fontSize(9).fillColor(gray)
      .text([contact.company ? `Atn: ${contact.name}` : null, contact.email, contact.phone ? `+${contact.phone}` : null]
        .filter(Boolean).join(' · '), left + 12, y + 37, { width: width - 24 });
    y += 74;

    // Tabla de partidas
    const cols = [
      { key: 'description', label: 'Concepto', w: width * 0.4, align: 'left' },
      { key: 'billing', label: 'Cobro', w: width * 0.1, align: 'center' },
      { key: 'quantity', label: 'Cant.', w: width * 0.08, align: 'right' },
      { key: 'unit_price', label: 'P. unitario', w: width * 0.14, align: 'right' },
      { key: 'discount_pct', label: 'Desc.', w: width * 0.1, align: 'right' },
      { key: 'line_subtotal', label: 'Importe', w: width * 0.18, align: 'right' },
    ];
    const drawHeader = () => {
      doc.rect(left, y, width, 20).fill(brand);
      let x = left;
      doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(8.5);
      for (const c of cols) {
        doc.text(c.label, x + 5, y + 6, { width: c.w - 10, align: c.align });
        x += c.w;
      }
      y += 20;
    };
    drawHeader();

    doc.font('Helvetica').fontSize(8.5);
    items.forEach((it, idx) => {
      const cells = {
        description: it.description,
        billing: BILLING_LABEL[it.billing] || it.billing,
        quantity: String(it.quantity),
        unit_price: money(it.unit_price, cur),
        discount_pct: it.discount_pct ? `${it.discount_pct}%` : '—',
        line_subtotal: money(it.line_subtotal, cur),
      };
      const h = Math.max(18, doc.heightOfString(cells.description, { width: cols[0].w - 10 }) + 10);
      if (y + h > doc.page.height - 200) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
        doc.font('Helvetica').fontSize(8.5);
      }
      if (idx % 2 === 1) doc.rect(left, y, width, h).fill('#F7F7F7');
      let x = left;
      doc.fillColor('#000');
      for (const c of cols) {
        doc.text(cells[c.key], x + 5, y + 5, { width: c.w - 10, align: c.align });
        x += c.w;
      }
      y += h;
    });
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#DDD').stroke();

    // Totales
    y += 10;
    const tx = left + width * 0.55;
    const tw = width * 0.45;
    const row = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#000');
      doc.text(label, tx, y, { width: tw * 0.5 });
      doc.text(value, tx + tw * 0.5, y, { width: tw * 0.5, align: 'right' });
      y += bold ? 18 : 14;
    };
    row('Subtotal', money(quote.subtotal, cur));
    if (quote.discount_total > 0) row('Descuento', `-${money(quote.discount_total, cur)}`);
    row('IVA', money(quote.tax_total, cur));
    doc.moveTo(tx, y).lineTo(tx + tw, y).strokeColor(brand).stroke();
    y += 5;
    row(`Total ${cur}`, money(quote.total, cur), true);
    if (quote.recurring_total > 0) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(gray)
        .text(`Incluye ${money(quote.recurring_total, cur)} (IVA incluido) de servicios recurrentes.`, tx, y, { width: tw, align: 'right' });
      y = doc.y + 6;
    }

    // Notas y condiciones
    y += 12;
    const block = (title, text) => {
      if (!text) return;
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.fillColor(brand).font('Helvetica-Bold').fontSize(9).text(title, left, y);
      doc.fillColor(gray).font('Helvetica').fontSize(8.5).text(text, left, doc.y + 3, { width });
      y = doc.y + 12;
    };
    block('Notas', quote.notes);
    block('Términos y condiciones', quote.terms);

    doc.end();
  });
}
