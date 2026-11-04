import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "./timetable.js";

export async function reportRows(semesterId: string) {
  const sessions = await prisma.timetableSession.findMany({ where: { semesterId }, include: { subject: true, teacher: true, room: true, sections: { include: { section: true } } }, orderBy: [{ day: "asc" }, { startTime: "asc" }] });
  return sessions.map((session) => ({ Day: session.day, Start: session.startTime, End: session.endTime, Sections: session.sections.map((entry) => entry.section.name).join(", "), Subject: `${session.subject.code} — ${session.subject.name}`, Faculty: session.teacher.name, Room: session.room.name, Locked: session.isLocked ? "Yes" : "No" }));
}
export const csv = (rows: Record<string, string>[]) => {
  const headers = Object.keys(rows[0] ?? { Day: "" }); const escape = (value: string) => `"${String(value).replaceAll('"', '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header] ?? "")).join(","))].join("\n");
};
export async function xlsx(rows: Record<string, string>[]) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Master Timetable");
  sheet.columns = Object.keys(rows[0] ?? { Day: "" }).map((header) => ({ header, key: header, width: Math.max(14, header.length + 4) })); sheet.addRows(rows); sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17213A" } }; sheet.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function pdf(rows: Record<string, string>[]) {
  return new Promise<Buffer>((resolve, reject) => { const document = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" }); const chunks: Uint8Array[] = []; document.on("data", (chunk: Uint8Array) => chunks.push(chunk)); document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); document.fontSize(18).text("Department of Computer Applications — Master Timetable"); document.moveDown(); document.fontSize(8); for (const row of rows) document.text(`${row.Day}  ${row.Start}-${row.End}  ${row.Sections}  |  ${row.Subject}  |  ${row.Faculty}  |  ${row.Room}`); document.end(); });
}
