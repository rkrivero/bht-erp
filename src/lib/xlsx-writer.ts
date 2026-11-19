import { deflateRawSync } from "node:zlib";

export type XlsxCellKind = "string" | "number" | "integer" | "currency";

export interface XlsxColumnDef {
  key: string;
  header: string;
  width?: number;
  kind?: XlsxCellKind;
}

export interface XlsxSheetInput {
  name: string;
  columns: XlsxColumnDef[];
  rows: Array<Record<string, unknown>>;
  totalsRow?: Record<string, unknown>;
  freezeHeader?: boolean;
  autoFilter?: boolean;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function escapeXml(raw: string): string {
  return raw
    .replace(CONTROL_CHAR_RE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Prevent spreadsheet formula execution on untrusted string cells without altering SKU codes like 000100340200. */
export function sanitizeXlsxText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value).replace(CONTROL_CHAR_RE, "");
  if (/^[\t\r ]*[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function colIndexToLetter(zeroBasedIdx: number): string {
  let n = zeroBasedIdx + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function sanitizeSheetName(name: string, fallbackIndex: number): string {
  const cleaned = name
    .replace(/[\\/?*[\]:]/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned || `Hoja${fallbackIndex + 1}`;
}

/**
 * Style indices in xl/styles.xml:
 * 0: default text
 * 1: header (bold white on Horizon Navy #102A43)
 * 2: text normal (thin bottom border)
 * 3: number #,##0.##
 * 4: integer #,##0
 * 5: currency S/ #,##0.00
 * 6: totals label (bold, light fill, top/bottom border)
 * 7: totals number #,##0.## (bold, light fill)
 * 8: totals integer #,##0 (bold, light fill)
 * 9: totals currency S/ #,##0.00 (bold, light fill)
 * 10: zebra text (subtle paper tint)
 * 11: zebra number
 * 12: zebra integer
 * 13: zebra currency
 */
function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0.##"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
    <numFmt numFmtId="166" formatCode="&quot;S/ &quot;#,##0.00"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="10"/><color rgb="FF0B192C"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF102A43"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF102A43"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FB"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left/><right/><top/>
      <bottom style="thin"><color rgb="FFD5E0E9"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left/><right/>
      <top style="thin"><color rgb="FF102A43"/></top>
      <bottom style="double"><color rgb="FF102A43"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="49" fontId="2" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="2" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="2" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function styleIdForCell(
  kind: XlsxCellKind,
  variant: "normal" | "zebra" | "totals"
): number {
  const offset =
    kind === "string" ? 0 : kind === "number" ? 1 : kind === "integer" ? 2 : 3;
  if (variant === "totals") return 6 + offset;
  if (variant === "zebra") return 10 + offset;
  return 2 + offset;
}

function renderCellXml(
  ref: string,
  rawValue: unknown,
  kind: XlsxCellKind,
  variant: "normal" | "zebra" | "totals"
): string {
  const styleId = styleIdForCell(kind, variant);
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return `<c r="${ref}" s="${styleId}"/>`;
  }
  if (kind !== "string") {
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (Number.isFinite(num)) {
      return `<c r="${ref}" t="n" s="${styleId}"><v>${num}</v></c>`;
    }
  }
  const safeText = escapeXml(sanitizeXlsxText(rawValue));
  return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${safeText}</t></is></c>`;
}

function buildWorksheetXml(sheet: XlsxSheetInput): string {
  const cols = sheet.columns;
  const colWidths = cols.map((c) => {
    if (c.width && c.width > 0) return c.width;
    let maxLen = c.header.length;
    for (const row of sheet.rows) {
      const val = row[c.key];
      if (val !== null && val !== undefined) {
        maxLen = Math.max(maxLen, String(val).length);
      }
    }
    return Math.max(12, Math.min(48, maxLen + 4));
  });

  const colsXml = colWidths
    .map(
      (w, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`
    )
    .join("");

  const rowXmls: string[] = [];

  // Row 1: header
  const headerCells = cols
    .map((c, idx) => {
      const ref = `${colIndexToLetter(idx)}1`;
      return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${escapeXml(c.header)}</t></is></c>`;
    })
    .join("");
  rowXmls.push(`<row r="1" ht="26" customHeight="1">${headerCells}</row>`);

  // Data rows
  sheet.rows.forEach((row, rIdx) => {
    const excelRow = rIdx + 2;
    const variant = rIdx % 2 === 1 ? "zebra" : "normal";
    const cells = cols
      .map((c, cIdx) => {
        const ref = `${colIndexToLetter(cIdx)}${excelRow}`;
        return renderCellXml(ref, row[c.key], c.kind ?? "string", variant);
      })
      .join("");
    rowXmls.push(`<row r="${excelRow}" ht="20" customHeight="1">${cells}</row>`);
  });

  // Optional totals row
  if (sheet.totalsRow) {
    const totalsExcelRow = sheet.rows.length + 2;
    const cells = cols
      .map((c, cIdx) => {
        const ref = `${colIndexToLetter(cIdx)}${totalsExcelRow}`;
        const raw = sheet.totalsRow?.[c.key];
        const cellKind: XlsxCellKind =
          raw === undefined || raw === null
            ? (c.kind ?? "string")
            : typeof raw === "number"
              ? (c.kind ?? "number")
              : "string";
        return renderCellXml(ref, raw, cellKind, "totals");
      })
      .join("");
    rowXmls.push(`<row r="${totalsExcelRow}" ht="22" customHeight="1">${cells}</row>`);
  }

  const lastCol = colIndexToLetter(Math.max(0, cols.length - 1));
  const lastDataRow = Math.max(1, sheet.rows.length + 1);
  const lastRow = sheet.totalsRow ? sheet.rows.length + 2 : lastDataRow;
  const dimensionRef = `A1:${lastCol}${lastRow}`;

  const sheetViewsXml =
    sheet.freezeHeader !== false
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const autoFilterXml =
    sheet.autoFilter !== false && cols.length > 0
      ? `<autoFilter ref="A1:${lastCol}${lastDataRow}"/>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimensionRef}"/>
  ${sheetViewsXml}
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowXmls.join("")}</sheetData>
  ${autoFilterXml}
</worksheet>`;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function createZipBuffer(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const uncompressed = entry.data;
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x5821, 12); // mod date
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x5821, 14); // mod date
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/** Build a valid OOXML (.xlsx) workbook buffer with explicit string cell typing for SKUs. */
export function buildXlsxWorkbook(sheets: XlsxSheetInput[]): Buffer {
  if (!sheets.length) {
    throw new Error("Workbook requires at least one sheet");
  }

  const usedNames = new Set<string>();
  const normalizedSheets = sheets.map((sheet, idx) => {
    const baseName = sanitizeSheetName(sheet.name, idx);
    let candidate = baseName;
    let suffix = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const tag = ` (${suffix})`;
      candidate = `${baseName.slice(0, Math.max(1, 31 - tag.length))}${tag}`;
      suffix += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return {
      ...sheet,
      name: candidate,
    };
  });

  const contentTypeOverrides = normalizedSheets
    .map(
      (_, idx) =>
        `  <Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("\n");

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${contentTypeOverrides}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const sheetsXml = normalizedSheets
    .map(
      (s, idx) =>
        `    <sheet name="${escapeXml(s.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
    )
    .join("\n");

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${sheetsXml}
  </sheets>
</workbook>`;

  const sheetRels = normalizedSheets
    .map(
      (_, idx) =>
        `  <Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join("\n");
  const stylesRelId = `rId${normalizedSheets.length + 1}`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetRels}
  <Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(buildStylesXml(), "utf8") },
  ];

  normalizedSheets.forEach((sheet, idx) => {
    entries.push({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: Buffer.from(buildWorksheetXml(sheet), "utf8"),
    });
  });

  return createZipBuffer(entries);
}
