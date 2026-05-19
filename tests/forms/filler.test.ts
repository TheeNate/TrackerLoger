import { describe, it, expect } from "vitest";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { fillForm } from "../../server/forms/filler";

const MISTRAS_BLANK = path.resolve(
  __dirname, "..", "..", "server", "forms", "blanks", "MISTRAS_OJT_Fillable.pdf",
);

describe("fillForm", () => {
  it("writes a value into a named field and the value reads back", async () => {
    const out = await fillForm(MISTRAS_BLANK, {
      employee_name: "Round Trip",
      employee_number: "12345",
    });

    const reopened = await PDFDocument.load(out);
    const form = reopened.getForm();
    expect(form.getTextField("employee_name").getText()).toBe("Round Trip");
    expect(form.getTextField("employee_number").getText()).toBe("12345");
  });

  it("sets /NeedAppearances=true on the AcroForm dict", async () => {
    const out = await fillForm(MISTRAS_BLANK, { employee_name: "x" });
    // The blank uses compressed object streams (ObjStm), so a raw-byte textual
    // probe is unreliable. Reload the output and verify via pdf-lib's own API.
    const reopened = await PDFDocument.load(out);
    const { PDFName } = await import("pdf-lib");
    const acroFormRef = reopened.catalog.get(PDFName.of("AcroForm"));
    const acroFormObj = reopened.context.lookup(acroFormRef as import("pdf-lib").PDFRef);
    const needApp = (acroFormObj as import("pdf-lib").PDFDict).get(PDFName.of("NeedAppearances"));
    expect(needApp?.toString()).toBe("true");
  });
});
