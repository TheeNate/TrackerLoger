import { describe, it, expect } from "vitest";
import path from "path";
import { promises as fs } from "fs";
import { PDFDocument } from "pdf-lib";
import { fillForm } from "../../server/forms/filler";

const CW_BLANK = path.resolve(
  __dirname, "..", "..", "server", "forms", "blanks", "CurtissWright_WorkExperience_Fillable.pdf",
);

describe("fillForm", () => {
  it("writes a value into a named field and the value reads back", async () => {
    const out = await fillForm(CW_BLANK, {
      name: "Round Trip",
      job_number: "12345",
    });

    const reopened = await PDFDocument.load(out);
    const form = reopened.getForm();
    expect(form.getTextField("name").getText()).toBe("Round Trip");
    expect(form.getTextField("job_number").getText()).toBe("12345");
  });

  it("accepts blank bytes as well as a path", async () => {
    const out = await fillForm(await fs.readFile(CW_BLANK), { name: "From Bytes" });
    const reopened = await PDFDocument.load(out);
    expect(reopened.getForm().getTextField("name").getText()).toBe("From Bytes");
  });

  it("sets /NeedAppearances=true on the AcroForm dict", async () => {
    const out = await fillForm(CW_BLANK, { name: "x" });
    // Blanks may use compressed object streams (ObjStm), so a raw-byte textual
    // probe is unreliable. Reload the output and verify via pdf-lib's own API.
    const reopened = await PDFDocument.load(out);
    const { PDFName } = await import("pdf-lib");
    const acroFormRef = reopened.catalog.get(PDFName.of("AcroForm"));
    const acroFormObj = reopened.context.lookup(acroFormRef as import("pdf-lib").PDFRef);
    const needApp = (acroFormObj as import("pdf-lib").PDFDict).get(PDFName.of("NeedAppearances"));
    expect(needApp?.toString()).toBe("true");
  });
});

const CW_SCHEMA = path.resolve(
  __dirname, "..", "..", "server", "forms", "schemas", "curtiss_wright_wer_v1.schema.json",
);

async function fieldNamesInBlank(blankPath: string): Promise<string[]> {
  const bytes = await fs.readFile(blankPath);
  const doc = await PDFDocument.load(bytes);
  return doc.getForm().getFields().map((f) => f.getName()).sort();
}

async function fieldNamesInSchema(schemaPath: string): Promise<string[]> {
  const json = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  return [...json.all_pdf_field_names].sort();
}

describe("blank ↔ schema field-name parity", () => {
  it("Curtiss-Wright blank matches its schema", async () => {
    const inBlank = await fieldNamesInBlank(CW_BLANK);
    const inSchema = await fieldNamesInSchema(CW_SCHEMA);
    expect(inBlank).toEqual(inSchema);
  });
});
