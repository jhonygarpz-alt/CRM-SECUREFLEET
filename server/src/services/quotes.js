import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { round2 } from '../utils.js';

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
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');
const FONT = (name) => path.join(ASSETS, 'fonts', `Carlito-${name}.ttf`);
const LOGO = path.join(ASSETS, 'logo.jpeg');

// Paleta del formato "Propuesta Económica" de SecureFleet.
const C = { bar: '#10233F', navy: '#1F3864', teal: '#0FA3B1', footer: '#6FE3EE', gray: '#595959', text: '#000000', sub: '#333333' };

/** Texto de la columna "Cantidad": cantidad, o la periodicidad cuando es un servicio recurrente. */
function qtyLabel(it) {
  const q = Number(it.quantity);
  const qty = Number.isInteger(q) ? String(q) : String(q.toFixed(2));
  if (it.billing === 'mensual') return q === 1 ? 'Mensual' : `${qty} (mensual)`;
  if (it.billing === 'anual') return q === 1 ? 'Anual' : `${qty} (anual)`;
  return qty;
}

/** Convierte los términos (uno por renglón o en un solo párrafo) en viñetas. */
function termLines(terms) {
  if (!terms) return [];
  const lines = String(terms).split(/\r?\n/).map((l) => l.replace(/^[\s•\-*·]+/, '').trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return String(terms).split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/).map((l) => l.trim()).filter(Boolean);
}

/** Genera el PDF de la cotización con el formato "Propuesta Económica" y regresa un Buffer. */
export function renderQuotePdf({ quote, items, contact, settings, seller, logo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 30, left: 57.5, right: 57.5 }, bufferPages: true,
      info: { Title: `Propuesta Económica ${quote.folio}`, Author: settings.company_name || 'SecureFleet' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const hasFonts = fs.existsSync(FONT('Regular'));
    const F = hasFonts
      ? { r: 'C-R', b: 'C-B', i: 'C-I', bi: 'C-BI' }
      : { r: 'Helvetica', b: 'Helvetica-Bold', i: 'Helvetica-Oblique', bi: 'Helvetica-BoldOblique' };
    if (hasFonts) {
      doc.registerFont('C-R', FONT('Regular'));
      doc.registerFont('C-B', FONT('Bold'));
      doc.registerFont('C-I', FONT('Italic'));
      doc.registerFont('C-BI', FONT('BoldItalic'));
    }

    const L = 57.5;
    const W = doc.page.width - L * 2; // 497
    const R = L + W;
    const cur = quote.currency || 'MXN';
    const PAGE_BOTTOM = 686; // arriba de los datos fiscales y la franja del pie
    const website = String(settings.company_website || 'consultingsecurefleet.com.mx').replace(/^https?:\/\//, '').replace(/\/$/, '');

    const frame = () => {
      doc.save().rect(L, 0, W, 16.75).fill(C.bar).restore();
      doc.save().rect(L, 710.9, W, 22).fill(C.bar).restore();
      doc.font(F.b).fontSize(9).fillColor(C.footer).text(website, L, 716, { width: W, align: 'center', lineBreak: false });
      // Datos fiscales del emisor, en pequeño, arriba de la franja del pie.
      const fiscal = [
        settings.company_legal_name,
        settings.company_rfc && `RFC: ${settings.company_rfc}`,
        settings.company_address,
        settings.company_phone && `Tel. ${settings.company_phone}`,
        settings.company_email,
      ].filter(Boolean).join('  ·  ');
      if (fiscal) {
        doc.font(F.r).fontSize(7).fillColor(C.gray).text(fiscal, L, 697, { width: W, align: 'center', lineBreak: false, ellipsis: true });
      }
    };
    frame();
    doc.on('pageAdded', frame);

    // ---- Encabezado ----
    const logoSrc = logo || (fs.existsSync(LOGO) ? LOGO : null);
    if (logoSrc) {
      try {
        doc.image(logoSrc, L + W / 2 - 60, 22.75, { fit: [120, 31.5], align: 'center', valign: 'center' });
      } catch {
        /* imagen no compatible: se omite el logo */
      }
    }
    doc.font(F.b).fontSize(16).fillColor(C.navy).text(String(settings.company_name || 'SecureFleet').toUpperCase(), L, 56, { width: W, align: 'center' });
    doc.font(F.r).fontSize(7).fillColor(C.gray).text(settings.company_tagline || 'FLEET INTELLIGENCE', L, 75, { width: W, align: 'center', characterSpacing: 2 });
    doc.font(F.bi).fontSize(9).fillColor(C.teal).text(settings.company_slogan || 'Seguridad Patrimonial y Monitoreo de Flotas', L, 85, { width: W, align: 'center' });
    doc.moveTo(L, 114.2).lineTo(R, 114.2).lineWidth(1).strokeColor(C.teal).stroke();

    doc.font(F.b).fontSize(14).fillColor(C.navy).text('PROPUESTA ECONÓMICA', L, 122, { width: W, align: 'center' });
    let y = 140;
    if (quote.title) {
      doc.font(F.i).fontSize(10).fillColor(C.sub).text(quote.title, L, y, { width: W, align: 'center' });
      y = doc.y;
    }
    y = Math.max(y + 8, 158);

    // ---- Datos del cliente ----
    const field = (label, value, x, yy, opts = {}) => {
      doc.font(F.b).fontSize(10.5).fillColor(C.text).text(`${label}: `, x, yy, { continued: true, ...opts })
        .font(F.r).text(value || '—', opts);
    };
    const validDays = quote.valid_until && quote.issue_date
      ? Math.round((new Date(quote.valid_until + 'T12:00:00') - new Date(quote.issue_date + 'T12:00:00')) / 86400000)
      : null;
    field('Empresa', contact.company || contact.name, L, y);
    if (contact.company) field('Contacto', contact.name, L, doc.y + 2);
    const fy = doc.y + 2;
    doc.font(F.b).fontSize(10.5).fillColor(C.text).text('Fecha: ', L, fy, { continued: true })
      .font(F.r).text(fmtDate(quote.issue_date), { continued: true })
      .font(F.b).text('      Vigencia: ', { continued: true })
      .font(F.r).text(validDays ? `${validDays} días naturales` : fmtDate(quote.valid_until), { continued: true })
      .font(F.b).text('      Folio: ', { continued: true })
      .font(F.r).text(quote.folio);
    if (seller) field(`Asesor ${settings.company_name || 'SecureFleet'}`, seller.name, L, doc.y + 2);

    // ---- Tabla ----
    const col = { concept: { x: L + 5.5, w: 235 }, qty: { x: L + 250, w: 90 }, amount: { x: R - 150, w: 144.5 } };
    const header = (yy) => {
      doc.font(F.b).fontSize(9.5).fillColor(C.navy);
      doc.text('CONCEPTO', col.concept.x, yy, { width: col.concept.w, lineBreak: false });
      doc.text('CANTIDAD', col.qty.x, yy, { width: col.qty.w, align: 'center', lineBreak: false });
      doc.text('IMPORTE', col.amount.x, yy, { width: col.amount.w, align: 'right', lineBreak: false });
      doc.moveTo(L, yy + 17).lineTo(R, yy + 17).lineWidth(1.2).strokeColor(C.navy).stroke();
      return yy + 26;
    };
    y = header(doc.y + 14);

    for (const it of items) {
      const concept = it.discount_pct > 0 ? `${it.description} (descuento ${it.discount_pct}%)` : it.description;
      doc.font(F.r).fontSize(9.5);
      const h = doc.heightOfString(concept, { width: col.concept.w, align: 'justify', lineGap: 1.5 });
      if (y + h > PAGE_BOTTOM - 20) {
        doc.addPage();
        y = header(40);
      }
      doc.font(F.r).fontSize(9.5).fillColor(C.text).text(concept, col.concept.x, y, { width: col.concept.w, align: 'justify', lineGap: 1.5 });
      doc.text(qtyLabel(it), col.qty.x, y, { width: col.qty.w, align: 'center' });
      doc.font(F.b).text(money(it.line_subtotal, cur), col.amount.x, y, { width: col.amount.w, align: 'right' });
      y += h + 8;
    }
    doc.moveTo(L, y - 4).lineTo(R, y - 4).lineWidth(1.2).strokeColor(C.navy).stroke();
    y += 12;

    // ---- Totales (antes de IVA) ----
    const sum = (b) => items.filter((it) => (it.billing || 'unico') === b).reduce((a, it) => a + Number(it.line_subtotal || 0), 0);
    const initial = sum('unico');
    const monthly = sum('mensual');
    const annual = sum('anual');
    const totals = [];
    if (initial > 0 || (!monthly && !annual)) totals.push(`${settings.quote_label_initial || 'INVERSIÓN INICIAL'} (${cur}, antes de IVA): ${money(initial, cur)}`);
    if (monthly > 0) totals.push(`${settings.quote_label_monthly || 'SERVICIO MENSUAL'} (${cur}, antes de IVA): ${money(monthly, cur)} / mes`);
    if (annual > 0) totals.push(`${settings.quote_label_annual || 'SERVICIO ANUAL'} (${cur}, antes de IVA): ${money(annual, cur)} / año`);

    const ensure = (need) => {
      if (y + need > PAGE_BOTTOM) {
        doc.addPage();
        y = 40;
      }
    };
    // Izquierda: inversión inicial / servicios recurrentes. Derecha: desglose Importe, IVA y Total.
    ensure(78);
    const boxW = 190;
    const boxX = R - boxW;
    const top = y;
    doc.font(F.b).fontSize(10).fillColor(C.navy);
    for (const t of totals) {
      doc.text(t, L, y, { width: W - boxW - 14 });
      y = doc.y + 2;
    }
    const leftBottom = y;

    const rates = [...new Set(items.map((it) => Number(it.tax_rate)))];
    const ivaLabel = rates.length === 1 ? `IVA (${Math.round(rates[0] * 100)}%)` : 'IVA';
    const importe = Number(quote.subtotal) - Number(quote.discount_total || 0);
    const rows = [['Importe (antes de IVA)', money(importe, cur)], [ivaLabel, money(quote.tax_total, cur)]];
    const boxH = rows.length * 15 + 34;
    doc.save().rect(boxX, top - 4, boxW, boxH).fill('#F2F5FB').restore();
    let by = top + 2;
    for (const [label, value] of rows) {
      doc.font(F.r).fontSize(9.5).fillColor(C.text).text(label, boxX + 10, by, { width: 100 });
      doc.text(value, boxX + 90, by, { width: boxW - 100, align: 'right' });
      by += 15;
    }
    doc.moveTo(boxX + 10, by).lineTo(R - 10, by).lineWidth(1).strokeColor(C.navy).stroke();
    by += 5;
    doc.font(F.b).fontSize(13).fillColor(C.navy).text(`TOTAL ${cur}`, boxX + 10, by, { width: 90 });
    doc.text(money(quote.total, cur), boxX + 80, by, { width: boxW - 90, align: 'right' });
    if (monthly > 0 || annual > 0) {
      doc.font(F.i).fontSize(7.5).fillColor(C.gray)
        .text(`El total con IVA incluye el primer ${monthly > 0 ? 'mes' : 'año'} de los servicios recurrentes.`, L, leftBottom + 2, { width: W - boxW - 14 });
    }
    y = Math.max(doc.y, top - 4 + boxH) + 6;

    if (quote.notes) {
      doc.font(F.i).fontSize(7.5).fillColor(C.gray);
      ensure(doc.heightOfString(quote.notes, { width: W }) + 4);
      doc.text(quote.notes, L, y, { width: W, align: 'justify', lineGap: 1.5 });
      y = doc.y + 6;
    }

    // ---- Firmas ----
    ensure(50);
    const sigY = y + 16;
    const half = (W - 11) / 2;
    if (seller) doc.font(F.r).fontSize(9.5).fillColor(C.text).text(seller.name, L + 5.5, sigY - 14, { width: half - 5 });
    doc.moveTo(L + 5.5, sigY).lineTo(L + 5.5 + half - 5, sigY).lineWidth(0.8).strokeColor('#000').stroke();
    doc.moveTo(L + 5.5 + half + 5, sigY).lineTo(R - 5.5, sigY).stroke();
    doc.font(F.r).fontSize(7.5).fillColor(C.gray);
    doc.text(`Nombre y Firma del Asesor ${settings.company_name || 'SecureFleet'}`, L + 5.5, sigY + 5, { width: half });
    doc.text('Nombre y Firma de la Aceptación de la Propuesta', L + 5.5 + half + 5, sigY + 5, { width: half });
    y = sigY + 22;

    // ---- Condiciones ----
    const terms = termLines(quote.terms);
    if (terms.length) {
      ensure(40);
      doc.font(F.b).fontSize(10).fillColor(C.navy).text('Condiciones', L, y);
      y = doc.y + 4;
      for (const t of terms) {
        doc.font(F.r).fontSize(9);
        const h = doc.heightOfString(t, { width: W - 20 });
        ensure(h + 4);
        doc.font(F.b).fillColor(C.navy).text('•', L + 9.5, y, { lineBreak: false });
        doc.font(F.r).fillColor(C.text).text(t, L + 17, y, { width: W - 20 });
        y = doc.y + 2;
      }
    }

    doc.end();
  });
}
