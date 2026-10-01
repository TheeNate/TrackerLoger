import { promises as fs } from "fs";
import path from "path";
import {
  PDFDocument, PDFName, PDFString, StandardFonts, rgb,
  type PDFFont, type PDFPage,
} from "pdf-lib";
import { LENDT_MAX_ROWS, type LendtColumn } from "./adapters/lendt_ojt_v1";
import { BLANKS_DIR } from "./paths";

// The Lê NDT Experience Hours (OJT) form has no vendor-supplied PDF, and its
// method columns vary per export (only methods with hours are drawn), so the
// blank AcroForm is drawn here on demand instead of being loaded from blanks/.

const LOGO_PATH = path.join(BLANKS_DIR, "LeNDT_logo.jpg");

const COLUMN_HEADS: Record<LendtColumn, string> = {
  ET: "ET", RFT: "RFT", MT: "MT", PT: "PT", RT: "RT",
  UT: "UT", UT_THK: "UT Thk", UTSW: "UTSW", PMI: "PMI", LSI: "LSI", PAUT: "PAUT",
  VT_1: "VT-1", VT_2: "VT-2", VT_3: "VT-3", VWE: "VWE",
};

// Landscape US Letter.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 28;

const DATE_W = 58;
// Method columns share the space left after the text columns' minimums, up to
// a cap; whatever is still free then widens Job Location and Supervisor.
const METHOD_W_MAX = 56;
const LOCATION_W_MIN = 130;
const SUPERVISOR_W_MIN = 110;
const LOCATION_SHARE = 0.58;

const TABLE_TOP = 472;
const HEAD_H = 22;
const ROW_H = 20;

const INK = rgb(0.1, 0.1, 0.1);
const ORANGE = rgb(0.95, 0.55, 0.1); // matches the logo script
const SHADE = rgb(0.93, 0.93, 0.93);

type Align = "left" | "center";

/** Draw a blank, fillable Lê NDT form carrying exactly the given method columns. */
export async function buildLendtBlank(columns: readonly LendtColumn[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Lê NDT — Experience Hours (OJT)");
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const acroForm = doc.getForm().acroForm;
  acroForm.dict.set(PDFName.of("DA"), PDFString.of("/Helv 0 Tf 0 g"));
  acroForm.dict.set(PDFName.of("DR"), doc.context.obj({ Font: { Helv: font.ref } }));
  acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(true));

  // Fields are single merged field+widget dicts (no /Kids), the same shape as
  // the vendor blanks — fillFormPages relies on that when it renames fields.
  function addField(
    name: string, tooltip: string,
    x: number, y: number, w: number, h: number,
    opts: { size?: number; align?: Align } = {},
  ) {
    const dict = doc.context.obj({
      Type: "Annot", Subtype: "Widget", FT: "Tx",
      T: PDFString.of(name), TU: PDFString.of(tooltip),
      V: PDFString.of(""), DV: PDFString.of(""),
      DA: PDFString.of(`/Helv ${opts.size ?? 9} Tf .1 .1 .1 rg`),
      Q: opts.align === "center" ? 1 : 0,
      F: 4, Ff: 0, MaxLen: 100,
      Rect: [x + 1.5, y + 1.5, x + w - 1.5, y + h - 1.5],
      P: page.ref,
    });
    const ref = doc.context.register(dict);
    page.node.addAnnot(ref);
    acroForm.addField(ref);
  }

  // ---- Letterhead ----
  // The JPEG carries ~10% white padding on every side, so it sits a little
  // outside the margin box to make the artwork itself align with it.
  const logo = await doc.embedJpg(await fs.readFile(LOGO_PATH));
  const logoH = 80;
  const logoW = (logo.width / logo.height) * logoH;
  page.drawImage(logo, { x: MARGIN - 6, y: 520, width: logoW, height: logoH });

  const title = "EXPERIENCE HOURS (OJT)";
  drawText(page, title, bold, 18, (PAGE_W - bold.widthOfTextAtSize(title, 18)) / 2, 556);
  const subtitle = "On-the-Job Training Log";
  drawText(page, subtitle, font, 10, (PAGE_W - font.widthOfTextAtSize(subtitle, 10)) / 2, 540);
  page.drawLine({
    start: { x: MARGIN, y: 518 }, end: { x: PAGE_W - MARGIN, y: 518 },
    thickness: 1.5, color: ORANGE,
  });

  // ---- Header fields ----
  const headerY = 490;
  labelledField(page, font, "Employee Name (Print):", MARGIN, headerY, 250,
    (x, w) => addField("employee_name", "Employee Name (printed)", x, headerY - 4, w, 18, { size: 10 }));
  labelledField(page, font, "Employee Number:", 440, headerY, 170,
    (x, w) => addField("employee_number", "Employee Number", x, headerY - 4, w, 18, { size: 10 }));

  // ---- Table ----
  const tableW = PAGE_W - 2 * MARGIN;
  const flexW = tableW - DATE_W;
  const methodW = columns.length === 0 ? 0 : Math.min(
    METHOD_W_MAX,
    (flexW - LOCATION_W_MIN - SUPERVISOR_W_MIN) / columns.length,
  );
  const textW = flexW - methodW * columns.length;
  const locationW = Math.round(textW * LOCATION_SHARE);

  const cols: { key: string; head: string; w: number; align: Align }[] = [
    { key: "date", head: "Job Date", w: DATE_W, align: "center" },
    { key: "location", head: "Job Location", w: locationW, align: "left" },
    ...columns.map((c) => ({ key: c as string, head: COLUMN_HEADS[c], w: methodW, align: "center" as Align })),
    { key: "supervisor", head: "Supervisor Signature", w: textW - locationW, align: "left" },
  ];
  const totalRows = LENDT_MAX_ROWS + 1; // + totals row
  const tableBottom = TABLE_TOP - HEAD_H - ROW_H * totalRows;

  // Shaded header and totals rows.
  page.drawRectangle({ x: MARGIN, y: TABLE_TOP - HEAD_H, width: tableW, height: HEAD_H, color: SHADE });
  page.drawRectangle({ x: MARGIN, y: tableBottom, width: tableW, height: ROW_H, color: SHADE });

  // Column heads + vertical rules. With every method in play the columns get
  // narrow, so the heads drop a point to keep clear of the rules.
  const headSize = methodW > 0 && methodW < 34 ? 7 : 8;
  let x = MARGIN;
  for (const col of cols) {
    drawText(page, col.head, bold, headSize,
      x + (col.w - bold.widthOfTextAtSize(col.head, headSize)) / 2, TABLE_TOP - HEAD_H + 7.5);
    page.drawLine({ start: { x, y: TABLE_TOP }, end: { x, y: tableBottom }, thickness: 0.6, color: INK });
    x += col.w;
  }
  page.drawLine({ start: { x, y: TABLE_TOP }, end: { x, y: tableBottom }, thickness: 0.6, color: INK });

  // Horizontal rules.
  page.drawLine({ start: { x: MARGIN, y: TABLE_TOP }, end: { x: MARGIN + tableW, y: TABLE_TOP }, thickness: 0.6, color: INK });
  for (let r = 0; r <= totalRows; r++) {
    const y = TABLE_TOP - HEAD_H - ROW_H * r;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + tableW, y }, thickness: 0.6, color: INK });
  }

  // Entry rows.
  for (let r = 1; r <= LENDT_MAX_ROWS; r++) {
    const y = TABLE_TOP - HEAD_H - ROW_H * r;
    x = MARGIN;
    for (const col of cols) {
      addField(`row_${r}_${col.key}`, `row ${r} ${col.head}`, x, y, col.w, ROW_H,
        { align: col.align, size: col.key === "location" || col.key === "supervisor" ? 8 : 9 });
      x += col.w;
    }
  }

  // Totals row.
  drawText(page, "TOTAL HOURS", bold, 8, MARGIN + DATE_W + 6, tableBottom + 6.5);
  x = MARGIN + DATE_W + locationW;
  for (const c of columns) {
    addField(`total_${c}`, `total ${COLUMN_HEADS[c]}`, x, tableBottom, methodW, ROW_H, { align: "center" });
    x += methodW;
  }

  // ---- Signature ----
  const sigY = 76;
  labelledField(page, font, "Employee Signature:", MARGIN, sigY, 260,
    (fx, w) => addField("employee_signature", "Employee Signature", fx, sigY - 4, w, 18, { size: 10 }));
  labelledField(page, font, "Date:", 440, sigY, 110,
    (fx, w) => addField("signature_date", "Signature Date", fx, sigY - 4, w, 18, { size: 10 }));

  const footer = "Lê NDT & Solutions — Asset Protection Services";
  drawText(page, footer, font, 7, (PAGE_W - font.widthOfTextAtSize(footer, 7)) / 2, 34, rgb(0.45, 0.45, 0.45));

  return doc.save({ updateFieldAppearances: false });
}

function drawText(
  page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, color = INK,
) {
  page.drawText(text, { x, y, size, font, color });
}

// Draws "Label: ________" and hands the underline's x/width to `place` so the
// caller can sit a field on it.
function labelledField(
  page: PDFPage, font: PDFFont, label: string, x: number, y: number, lineW: number,
  place: (x: number, w: number) => void,
) {
  drawText(page, label, font, 10, x, y);
  const lineX = x + font.widthOfTextAtSize(label, 10) + 6;
  page.drawLine({ start: { x: lineX, y: y - 3 }, end: { x: lineX + lineW, y: y - 3 }, thickness: 0.6, color: INK });
  place(lineX, lineW);
}
