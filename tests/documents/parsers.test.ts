import { describe, it, expect, beforeEach } from "vitest";
import {
    TextParser,
    CSVParser,
    getParser,
    registerParser,
    PARSER_REGISTRY,
    DocumentParser,
} from "../../src/documents/parsers.js";

describe("TextParser", () => {
    let parser: TextParser;

    beforeEach(() => {
        parser = new TextParser();
    });

    it("parses UTF-8 text from buffer", async () => {
        const buffer = Buffer.from("Hello, world!", "utf-8");
        const result = await parser.parse(buffer, "test.txt");
        expect(result).toBe("Hello, world!");
    });

    it("parses multi-line text", async () => {
        const buffer = Buffer.from("Line 1\nLine 2\nLine 3", "utf-8");
        const result = await parser.parse(buffer, "doc.txt");
        expect(result).toBe("Line 1\nLine 2\nLine 3");
    });

    it("parses empty buffer", async () => {
        const buffer = Buffer.from("", "utf-8");
        const result = await parser.parse(buffer, "empty.txt");
        expect(result).toBe("");
    });

    it("handles binary content gracefully", async () => {
        const buffer = Buffer.from([0xff, 0xfe, 0xfd]);
        const result = await parser.parse(buffer, "binary.bin");
        expect(typeof result).toBe("string");
    });
});

describe("CSVParser", () => {
    let parser: CSVParser;

    beforeEach(() => {
        parser = new CSVParser();
    });

    it("parses simple CSV", async () => {
        const csv = "Name,Age,City\nAlice,30,NYC\nBob,25,LA";
        const result = await parser.parse(Buffer.from(csv), "data.csv");
        const lines = result.split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe("Name | Age | City");
        expect(lines[1]).toBe("Alice | 30 | NYC");
    });

    it("handles quoted fields with commas inside", async () => {
        const csv = 'Name,Description\n"Acme, Inc.","A great company"';
        const result = await parser.parse(Buffer.from(csv), "data.csv");
        const lines = result.split("\n");
        expect(lines[0]).toBe("Name | Description");
        expect(lines[1]).toContain("Acme, Inc.");
        expect(lines[1]).toContain("A great company");
    });

    it("handles escaped quotes inside quoted fields", async () => {
        const csv = 'Col1\n"He said ""hello"" to me"';
        const result = await parser.parse(Buffer.from(csv), "data.csv");
        expect(result).toContain('He said "hello" to me');
    });

    it("skips empty lines", async () => {
        const csv = "A,B\n1,2\n\n\n3,4\n";
        const result = await parser.parse(Buffer.from(csv), "data.csv");
        const lines = result.split("\n");
        // Only A,B, 1,2, 3,4 should be present (no empty lines)
        expect(lines.length).toBe(3);
    });

    it("handles CRLF line endings", async () => {
        const csv = "Name,Age\r\nAlice,30\r\nBob,25";
        const result = await parser.parse(Buffer.from(csv), "data.csv");
        const lines = result.split("\n");
        expect(lines).toHaveLength(3);
    });
});

describe("getParser", () => {
    it("returns TextParser for .txt files", () => {
        const parser = getParser("document.txt");
        expect(parser).toBeInstanceOf(TextParser);
    });

    it("returns TextParser for .md files", () => {
        const parser = getParser("readme.md");
        expect(parser).toBeInstanceOf(TextParser);
    });

    it("returns CSVParser for .csv files", () => {
        const parser = getParser("data.csv");
        expect(parser).toBeInstanceOf(CSVParser);
    });

    it("throws for unsupported file types", () => {
        expect(() => getParser("file.xyz")).toThrow("Unsupported file type");
    });

    it("is case-insensitive for extensions", () => {
        const parser = getParser("FILE.TXT");
        expect(parser).toBeInstanceOf(TextParser);
    });
});

describe("registerParser", () => {
    let originalRegistry: Record<string, typeof DocumentParser>;

    beforeEach(() => {
        originalRegistry = { ...PARSER_REGISTRY };
        delete PARSER_REGISTRY[".json"];
    });

    afterEach(() => {
        for (const key of Object.keys(PARSER_REGISTRY)) {
            if (!(key in originalRegistry)) {
                delete PARSER_REGISTRY[key];
            }
        }
    });

    it("registers a new parser for a custom extension", () => {
        class JSONParser extends DocumentParser {
            async parse(fileBytes: Buffer, _filename: string): Promise<string> {
                return fileBytes.toString("utf-8");
            }
        }

        registerParser(".json", JSONParser);

        // Verify it's retrievable via getParser
        const parser = getParser("config.json");
        expect(parser).toBeInstanceOf(JSONParser);

        // Clean up
        delete PARSER_REGISTRY[".json"];
    });

    it("overrides existing parser registration", () => {
        class CustomTextParser extends DocumentParser {
            async parse(fileBytes: Buffer, _filename: string): Promise<string> {
                return `[CUSTOM] ${fileBytes.toString("utf-8")}`;
            }
        }

        registerParser(".txt", CustomTextParser);
        const parser = getParser("file.txt");
        expect(parser).toBeInstanceOf(CustomTextParser);

        // Restore original
        PARSER_REGISTRY[".txt"] = TextParser;
    });

    it("makes registered extension work with getParser", async () => {
        class YAMLParser extends DocumentParser {
            async parse(fileBytes: Buffer, _filename: string): Promise<string> {
                return `YAML: ${fileBytes.toString("utf-8")}`;
            }
        }

        registerParser(".yaml", YAMLParser);
        const parser = getParser("config.yaml");
        const result = await parser.parse(Buffer.from("key: value"), "config.yaml");
        expect(result).toBe("YAML: key: value");

        delete PARSER_REGISTRY[".yaml"];
    });
});
