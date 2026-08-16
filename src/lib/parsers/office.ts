import mammoth from "mammoth";
import * as XLSX from "xlsx";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function createOfficeParsers() {
  return [
    {
      supports: (mimeType: string) => mimeType === DOCX_MIME,
      async extract({ bytes }: { bytes: ArrayBuffer }) {
        const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return result.value;
      },
    },
    {
      supports: (mimeType: string) => mimeType === XLSX_MIME,
      async extract({ bytes }: { bytes: ArrayBuffer }) {
        const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer", cellText: true });
        return workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          return `## ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`;
        }).join("\n\n");
      },
    },
  ];
}
