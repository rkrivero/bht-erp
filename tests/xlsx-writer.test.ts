import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsxWorkbook, sanitizeXlsxText } from "../src/lib/xlsx-writer";

/** Minimal ZIP reader for test verification of uncompressed/deflated OOXML parts. */
function readZipEntries(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThan(-1);

  const cdCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let pos = cdOffset;

  for (let i = 0; i < cdCount; i += 1) {
    expect(buffer.readUInt32LE(pos)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

    expect(buffer.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compSize);
    const content =
      method === 8 ? inflateRawSync(raw).toString("utf8") : raw.toString("utf8");
    entries.set(name, content);

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

describe("OOXML Excel (.xlsx) Writer", () => {
  it("neutralizes spreadsheet formula injection and strips invalid control chars", () => {
    expect(sanitizeXlsxText("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeXlsxText("+1234")).toBe("'+1234");
    expect(sanitizeXlsxText("-999")).toBe("'-999");
    expect(sanitizeXlsxText("@cmd")).toBe("'@cmd");
    expect(sanitizeXlsxText("000100340200")).toBe("000100340200");
    expect(sanitizeXlsxText("ABC\u0000\u0007DEF")).toBe("ABCDEF");
  });

  it("builds a valid multi-sheet .xlsx ZIP preserving leading-zero SKUs as inline strings", () => {
    const buffer = buildXlsxWorkbook([
      {
        name: "Por Regularizar: [Test]/2026*?",
        freezeHeader: true,
        autoFilter: true,
        columns: [
          { key: "sku", header: "SKU", width: 18, kind: "string" },
          { key: "product", header: "Producto", width: 32, kind: "string" },
          { key: "qty", header: "Cantidad", width: 12, kind: "integer" },
          { key: "subtotal", header: "Subtotal (S/)", width: 16, kind: "currency" },
        ],
        rows: [
          {
            sku: "000100340200",
            product: 'CALIPER "57-25" & <NUEVO>',
            qty: 22,
            subtotal: 1772.94,
          },
          {
            sku: "=CMD()",
            product: "FILA SEGURA",
            qty: 1,
            subtotal: null,
          },
        ],
        totalsRow: {
          sku: "TOTAL",
          product: "",
          qty: 23,
          subtotal: 1772.94,
        },
      },
      {
        name: "Resumen",
        columns: [
          { key: "label", header: "Indicador", width: 24, kind: "string" },
          { key: "value", header: "Valor", width: 18, kind: "number" },
        ],
        rows: [{ label: "SKUs con déficit", value: 2 }],
      },
    ]);

    expect(buffer.subarray(0, 4).toString("binary")).toBe("PK\x03\x04");
    const entries = readZipEntries(buffer);

    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(entries.has("_rels/.rels")).toBe(true);
    expect(entries.has("xl/workbook.xml")).toBe(true);
    expect(entries.has("xl/_rels/workbook.xml.rels")).toBe(true);
    expect(entries.has("xl/styles.xml")).toBe(true);
    expect(entries.has("xl/worksheets/sheet1.xml")).toBe(true);
    expect(entries.has("xl/worksheets/sheet2.xml")).toBe(true);

    const workbookXml = entries.get("xl/workbook.xml")!;
    const sheetNames = Array.from(workbookXml.matchAll(/<sheet name="([^"]+)"/g)).map(
      (m) => m[1]
    );
    expect(sheetNames).toHaveLength(2);
    expect(sheetNames[0]).not.toMatch(/[\[\]:*?/\\]/);
    expect(sheetNames[0].length).toBeLessThanOrEqual(31);
    expect(sheetNames[1]).toBe("Resumen");

    const sheet1 = entries.get("xl/worksheets/sheet1.xml")!;
    // Leading-zero SKU must be written as explicit inlineStr, never numeric
    expect(sheet1).toContain(
      '<c r="A2" t="inlineStr" s="2"><is><t xml:space="preserve">000100340200</t></is></c>'
    );
    // XML special chars escaped properly
    expect(sheet1).toContain("CALIPER &quot;57-25&quot; &amp; &lt;NUEVO&gt;");
    // Formula injection escaped with leading apostrophe
    expect(sheet1).toContain('<t xml:space="preserve">&apos;=CMD()</t>');
    // Numeric & currency cells use numeric value tag
    expect(sheet1).toContain('<c r="C2" t="n" s="4"><v>22</v></c>');
    expect(sheet1).toContain('<c r="D2" t="n" s="5"><v>1772.94</v></c>');
    // Totals row rendered at row 4 with bold totals styles (s=6,8,9)
    expect(sheet1).toContain(
      '<c r="A4" t="inlineStr" s="6"><is><t xml:space="preserve">TOTAL</t></is></c>'
    );
    expect(sheet1).toContain('<c r="C4" t="n" s="8"><v>23</v></c>');
    expect(sheet1).toContain('<c r="D4" t="n" s="9"><v>1772.94</v></c>');
    // Freeze pane and autofilter present
    expect(sheet1).toContain('<pane ySplit="1" topLeftCell="A2"');
    expect(sheet1).toContain('<autoFilter ref="A1:D3"/>');
  });

  it("handles empty rows and deduplicates identical sheet names gracefully", () => {
    const buffer = buildXlsxWorkbook([
      {
        name: "Hoja",
        columns: [{ key: "col", header: "Col", width: 12, kind: "string" }],
        rows: [],
      },
      {
        name: "Hoja",
        columns: [{ key: "col", header: "Col", width: 12, kind: "string" }],
        rows: [{ col: "" }],
      },
    ]);
    const entries = readZipEntries(buffer);
    const workbookXml = entries.get("xl/workbook.xml")!;
    expect(workbookXml).toContain('name="Hoja"');
    expect(workbookXml).toContain('name="Hoja (2)"');
  });
});
