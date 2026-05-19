import { promises as fs } from "fs";
import { PDFBool, PDFDocument, PDFName } from "pdf-lib";
import type { FieldValues } from "./types";

/**
 * Load a blank AcroForm PDF, set named text-field values, and return the
 * updated bytes. Fields stay editable in the resulting PDF.
 *
 * Sets /NeedAppearances=true on the AcroForm dict so values render in viewers
 * that don't compute appearances themselves. Skips pdf-lib's own appearance
 * generation (which would embed a font and bloat the output).
 */
export async function fillForm(
  blankPath: string,
  values: FieldValues,
): Promise<Uint8Array> {
  const bytes = await fs.readFile(blankPath);
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  for (const [name, value] of Object.entries(values)) {
    const field = form.getTextField(name);
    field.setText(value);
  }

  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (acroForm && "set" in acroForm && typeof acroForm.set === "function") {
    (acroForm as { set: (key: PDFName, value: PDFBool) => void }).set(
      PDFName.of("NeedAppearances"),
      PDFBool.True,
    );
  }

  return doc.save({ updateFieldAppearances: false });
}
