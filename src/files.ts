import ExcelJS from "exceljs";
import type { PbcRequest } from "./domain";

const normalize = (value: unknown) => String(value ?? "").trim();

export async function importRequests(file: File): Promise<Partial<PbcRequest>[]> {
  const workbook = new ExcelJS.Workbook();
  if (file.name.toLowerCase().endsWith(".csv")) {
    const rows = parseCsv(await file.text());
    const sheet = workbook.addWorksheet("Import");
    rows.forEach((row) => sheet.addRow(row));
  } else {
    await workbook.xlsx.load(await file.arrayBuffer());
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Fișierul nu conține nicio foaie.");
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => headers.set(normalize(cell.value).toLowerCase(), column));
  const column = (...names: string[]) => names.map((name) => headers.get(name)).find(Boolean);
  const result: Partial<PbcRequest>[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const get = (...names: string[]) => { const index = column(...names); return index ? normalize(row.getCell(index).text) : ""; };
    const title = get("cerință", "cerinta", "cerință auditor", "titlu");
    if (!title) return;
    result.push({
      code: get("cod", "#") || `REQ-${String(index - 1).padStart(2, "0")}`,
      area: get("arie audit", "arie") || "General",
      title,
      description: get("descriere"),
      instructions: get("instrucțiuni", "instructiuni"),
      period: get("perioadă", "perioada"),
      deadline: get("deadline", "termen"),
      priority: get("prioritate").toLowerCase().includes("urgent") ? "urgent" : "normal",
      status: "draft",
    });
  });
  if (!result.length) throw new Error("Nu am găsit cerințe. Prima linie trebuie să conțină antetele coloanelor.");
  return result;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && (character === "," || character === ";")) {
      row.push(value.trim()); value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export async function requestTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cerințe PBC");
  sheet.addRow(["Cod", "Arie audit", "Cerință", "Descriere", "Instrucțiuni", "Perioadă", "Deadline", "Prioritate"]);
  sheet.addRow(["FA-03", "Imobilizări", "Registrul mijloacelor fixe", "Registrul complet la 31.12.2026", "Includeți cost și amortizare cumulată", "FY2026", "2027-01-15", "Normală"]);
  sheet.columns.forEach((column) => { column.width = 24; });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3F88" } };
  const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "Model-import-cerinte-PBC.xlsx"; anchor.click();
  URL.revokeObjectURL(url);
}
