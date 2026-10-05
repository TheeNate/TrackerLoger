// Generates the Lê NDT Experience Hours (OJT) blank AcroForm and its schema.
// There is no vendor-supplied PDF for this form, so the blank is drawn here.
// Re-run after changing the layout or LENDT_COLUMNS, and commit the outputs:
//
//   npx tsx scripts/gen-lendt-blank.ts
import { promises as fs } from "fs";
import path from "path";
import {
  PDFDocument, PDFName, PDFString, StandardFonts, rgb,
  type PDFFont, type PDFPage,
} from "pdf-lib";
import { LENDT_COLUMNS, LENDT_MAX_ROWS, type LendtColumn } from "../server/forms/adapters/lendt_ojt_v1";

const LOGO_PATH = path.resolve("attached_assets", "lendt", "logo-vt.jpg");
const BLANK_PATH = path.resolve("server", "forms", "blanks", "LeNDT_OJT_Fillable.pdf");
const SCHEMA_PATH = path.resolve("server", "forms", "schemas", "lendt_ojt_v1.schema.json");

const COLUMN_LABELS: Record<LendtColumn, { head: string; label: string }> = {
  MT:   { head: "MT",   label: "Magnetic Particle Testing" },
  PT:   { head: "PT",   label: "Penetrant Testing (Liquid Penetrant)" },
  UT:   { head: "UT",   label: "Ultrasonic Testing" },
  VT_1: { head: "VT-1", label: "Visual Testing Level 1" },
  VT_2: { head: "VT-2", label: "Visual Testing Level 2 (also legacy plain VT rows)" },
  VT_3: { head: "VT-3", label: "Visual Testing Level 3" },
  VWE:  { head: "VWE",  label: "Visual Welding Examination" },
};

// Landscape US Letter.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 28;

const DATE_W = 58;
const LOCATION_W = 210;
const METHOD_W = 44;
const SUPERVISOR_W = PAGE_W - 2 * MARGIN - DATE_W - LOCATION_W - METHOD_W * LENDT_COLUMNS.length;

const TABLE_TOP = 472;
const HEAD_H = 22;
const ROW_H = 20;

const INK = rgb(0.1, 0.1, 0.1);
const ORANGE = rgb(0.95, 0.55, 0.1); // matches the logo script
const SHADE = rgb(0.93, 0.93, 0.93);

type Align = "left" | "center";

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle("Lê NDT — Experience Hours (OJT)");
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const acroForm = doc.getForm().acroForm;
  acroForm.dict.set(PDFName.of("DA"), PDFString.of("/Helv 0 Tf 0 g"));
  acroForm.dict.set(PDFName.of("DR"), doc.context.obj({ Font: { Helv: font.ref } }));
  acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(true));

  const fieldNames: string[] = [];

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
    fieldNames.push(name);
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
  const cols: { key: string; head: string; w: number; align: Align }[] = [
    { key: "date", head: "Job Date", w: DATE_W, align: "center" },
    { key: "location", head: "Job Location", w: LOCATION_W, align: "left" },
    ...LENDT_COLUMNS.map((c) => ({ key: c as string, head: COLUMN_LABELS[c].head, w: METHOD_W, align: "center" as Align })),
    { key: "supervisor", head: "Supervisor Signature", w: SUPERVISOR_W, align: "left" },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const totalRows = LENDT_MAX_ROWS + 1; // + totals row
  const tableBottom = TABLE_TOP - HEAD_H - ROW_H * totalRows;

  // Shaded header and totals rows.
  page.drawRectangle({ x: MARGIN, y: TABLE_TOP - HEAD_H, width: tableW, height: HEAD_H, color: SHADE });
  page.drawRectangle({ x: MARGIN, y: tableBottom, width: tableW, height: ROW_H, color: SHADE });

  // Column heads + vertical rules.
  let x = MARGIN;
  for (const col of cols) {
    const size = 8;
    drawText(page, col.head, bold, size,
      x + (col.w - bold.widthOfTextAtSize(col.head, size)) / 2, TABLE_TOP - HEAD_H + 7.5);
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
  x = MARGIN + DATE_W + LOCATION_W;
  for (const c of LENDT_COLUMNS) {
    addField(`total_${c}`, `total ${COLUMN_LABELS[c].head}`, x, tableBottom, METHOD_W, ROW_H, { align: "center" });
    x += METHOD_W;
  }

  // ---- Signature ----
  const sigY = 76;
  labelledField(page, font, "Employee Signature:", MARGIN, sigY, 260,
    (fx, w) => addField("employee_signature", "Employee Signature", fx, sigY - 4, w, 18, { size: 10 }));
  labelledField(page, font, "Date:", 440, sigY, 110,
    (fx, w) => addField("signature_date", "Signature Date", fx, sigY - 4, w, 18, { size: 10 }));

  const footer = "Lê NDT & Solutions — Asset Protection Services";
  drawText(page, footer, font, 7, (PAGE_W - font.widthOfTextAtSize(footer, 7)) / 2, 34, rgb(0.45, 0.45, 0.45));

  await fs.writeFile(BLANK_PATH, await doc.save({ updateFieldAppearances: false }));
  console.log("Wrote", BLANK_PATH, `(${fieldNames.length} fields)`);

  const schema = {
    form_id: "lendt_ojt_v1",
    company: "Lê NDT & Solutions",
    form_title: "Experience Hours (OJT)",
    blank_pdf: path.basename(BLANK_PATH),
    generated_by: "scripts/gen-lendt-blank.ts",
    page_count: 1,
    method_codes: [...LENDT_COLUMNS],
    method_code_labels: Object.fromEntries(LENDT_COLUMNS.map((c) => [c, COLUMN_LABELS[c].label])),
    max_entry_rows: LENDT_MAX_ROWS,
    fields: {
      header: {
        employee_name: { pdf_field: "employee_name", type: "text", label: "Employee Name (Print)" },
        employee_number: { pdf_field: "employee_number", type: "text", label: "Employee Number" },
      },
      rows_template: {
        description: `There are ${LENDT_MAX_ROWS} rows. PDF field names follow: row_<N>_<key> where N is 1..${LENDT_MAX_ROWS}.`,
        keys: {
          date: { label: "Job Date", format: "M/D/YYYY" },
          location: { label: "Job Location", format: "free text" },
          ...Object.fromEntries(LENDT_COLUMNS.map((c) => [c, { label: `${COLUMN_LABELS[c].head} hours`, format: "decimal hours" }])),
          supervisor: { label: "Supervisor Signature (typed)", format: "free text / initials" },
        },
      },
      totals: {
        description: "Total Hours row at bottom of table. PDF field names: total_<methodCode>.",
        fields: Object.fromEntries(LENDT_COLUMNS.map((c) => [`total_${c}`, { pdf_field: `total_${c}`, type: "text" }])),
      },
      signature: {
        employee_signature: { pdf_field: "employee_signature", type: "text", label: "Employee Signature" },
        signature_date: { pdf_field: "signature_date", type: "text", label: "Signature Date" },
      },
    },
    all_pdf_field_names: fieldNames,
  };
  await fs.writeFile(SCHEMA_PATH, JSON.stringify(schema, null, 2) + "\n");
  console.log("Wrote", SCHEMA_PATH);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
