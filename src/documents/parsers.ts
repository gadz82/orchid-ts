/** Pluggable document parsers — extract text from various file formats. */

import { extname } from "node:path";

const _documentsExtraHint =
    "Install via `npm install pdf-parse mammoth exceljs` to enable PDF / DOCX / XLSX parsing, " +
    "or install the underlying package directly.";

function _missingExtra(parserName: string, pkg: string): Error {
    return new Error(
        `${parserName} parsing requires the '${pkg}' package, which is not installed.\n${_documentsExtraHint}`,
    );
}

// ── ABC ───────────────────────────────────────────────────────────

export abstract class DocumentParser {
    abstract parse(fileBytes: Buffer, filename: string): Promise<string>;
}

// ── Concrete parsers ───────────────────────────────────────────────

export class PDFParser extends DocumentParser {
    async parse(fileBytes: Buffer, _filename: string): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pdfParse: any;
        try {
            // @ts-expect-error — pdf-parse may not be installed (optional dep)
            const mod = await import("pdf-parse");
            pdfParse = mod.default ?? mod;
        } catch {
            throw _missingExtra("PDF", "pdf-parse");
        }

        if (!pdfParse) throw _missingExtra("PDF", "pdf-parse");
        const data = await pdfParse(fileBytes);
        return data.text.trim();
    }
}

export class DOCXParser extends DocumentParser {
    async parse(fileBytes: Buffer, _filename: string): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mammoth: any;
        try {
            // @ts-expect-error — mammoth may not be installed (optional dep)
            mammoth = await import("mammoth");
        } catch {
            throw _missingExtra("DOCX", "mammoth");
        }

        if (!mammoth) throw _missingExtra("DOCX", "mammoth");
        const result = await mammoth.extractRawText({ buffer: fileBytes });
        return result.value.trim();
    }
}

export class XLSXParser extends DocumentParser {
    async parse(fileBytes: Buffer, _filename: string): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let ExcelJS: any;
        try {
            // @ts-expect-error — exceljs may not be installed (optional dep)
            ExcelJS = await import("exceljs");
        } catch {
            throw _missingExtra("XLSX", "exceljs");
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(fileBytes);

        const sheets: string[] = [];
        for (const ws of workbook.worksheets) {
            const rows: string[] = [];
            for (let r = 1; r <= ws.rowCount; r++) {
                const row = ws.getRow(r);
                const cells: string[] = [];
                row.eachCell({ includeEmpty: true }, (cell: { value: unknown }) => {
                    cells.push(cell.value != null ? String(cell.value) : "");
                });
                if (cells.some((c) => c !== "")) {
                    rows.push(cells.join(" | "));
                }
            }
            if (rows.length > 0) {
                sheets.push(`## Sheet: ${ws.name}\n${rows.join("\n")}`);
            }
        }

        return sheets.join("\n\n");
    }
}

export class CSVParser extends DocumentParser {
    async parse(fileBytes: Buffer, _filename: string): Promise<string> {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
        const lines = text.split(/\r?\n/);
        const rows: string[] = [];
        for (const line of lines) {
            if (!line.trim()) continue;
            const cells = _splitCSVLine(line);
            rows.push(cells.join(" | "));
        }
        return rows.join("\n");
    }
}

function _splitCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ",") {
                result.push(current);
                current = "";
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
}

export class TextParser extends DocumentParser {
    async parse(fileBytes: Buffer, _filename: string): Promise<string> {
        return new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
    }
}

export class ImageParser extends DocumentParser {
    private _visionModel: string;

    constructor(visionModel = "") {
        super();
        this._visionModel = visionModel;
    }

    async parse(fileBytes: Buffer, filename: string): Promise<string> {
        if (!this._visionModel) {
            return `[Image file: ${filename} — no vision model configured]`;
        }

        const ext = extname(filename).toLowerCase().replace(".", "");
        const mimeMap: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
        };
        const mime = mimeMap[ext] ?? "image/png";
        const b64 = fileBytes.toString("base64");

        try {
            const { ChatOpenAI } = await import("@langchain/openai");
            const { HumanMessage } = await import("@langchain/core/messages");

            const model = new ChatOpenAI({
                model: this._visionModel,
                temperature: 0,
            } as Record<string, unknown>);

            const response = await model.invoke([
                new HumanMessage({
                    content: [
                        {
                            type: "text",
                            text: "Extract all text and describe the content of this image in detail.",
                        },
                        { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
                    ],
                }),
            ]);

            const result = (response.content as string) || `[Image: ${filename}]`;
            return result;
        } catch {
            return `[Image file: ${filename} — vision extraction failed]`;
        }
    }
}

// ── Registry ────────────────────────────────────────────────────────

function _defaultRegistry(): Record<string, typeof DocumentParser> {
    return {
        ".pdf": PDFParser,
        ".docx": DOCXParser,
        ".xlsx": XLSXParser,
        ".csv": CSVParser,
        ".md": TextParser,
        ".txt": TextParser,
        ".png": ImageParser,
        ".jpg": ImageParser,
        ".jpeg": ImageParser,
    };
}

export const PARSER_REGISTRY: Record<string, typeof DocumentParser> = _defaultRegistry();

const SUPPORTED_EXTENSIONS = new Set(Object.keys(PARSER_REGISTRY));

export function registerParser(ext: string, cls: typeof DocumentParser): void {
    PARSER_REGISTRY[ext] = cls;
    SUPPORTED_EXTENSIONS.add(ext);
}

export function getParser(filename: string, opts?: { visionModel?: string }): DocumentParser {
    const ext = extname(filename).toLowerCase();
    const cls = PARSER_REGISTRY[ext];
    if (!cls) {
        const supported = [...SUPPORTED_EXTENSIONS].sort().join(", ");
        throw new Error(`Unsupported file type: ${ext}. Supported: ${supported}`);
    }
    if (cls === ImageParser) {
        return new ImageParser(opts?.visionModel);
    }
    return new (cls as new () => DocumentParser)();
}
