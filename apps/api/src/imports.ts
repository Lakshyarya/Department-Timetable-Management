import { prisma } from "./timetable.js";

type ImportRow = { facultyName?: string; shortName?: string; email?: string; subjectCode?: string };

const parseCsv = (text: string): ImportRow[] => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const read = (line: string) => line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
  const headers = read(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  return lines.slice(1).map((line) => {
    const values = read(line); const at = (names: string[]) => values[headers.findIndex((header) => names.includes(header))] || undefined;
    return { facultyName: at(["facultyname", "teachername", "name"]), shortName: at(["shortname", "initials"]), email: at(["email"]), subjectCode: at(["subjectcode", "code"]) };
  });
};

export async function importFacultySubjects(semesterId: string, csv: string) {
  const rows = parseCsv(csv); const subjects = await prisma.subject.findMany({ where: { semesterId }, select: { id: true, code: true } });
  const byCode = new Map(subjects.map((subject) => [subject.code.toLowerCase(), subject]));
  const errors: { row: number; message: string }[] = []; let imported = 0; let facultyCreated = 0;
  for (const [index, row] of rows.entries()) {
    if (!row.facultyName || !row.subjectCode) { errors.push({ row: index + 2, message: "facultyName and subjectCode are required." }); continue; }
    const subject = byCode.get(row.subjectCode.toLowerCase());
    if (!subject) { errors.push({ row: index + 2, message: `Subject code '${row.subjectCode}' does not exist in this semester.` }); continue; }
    let faculty = await prisma.faculty.findFirst({ where: { name: { equals: row.facultyName, mode: "insensitive" } } });
    if (!faculty) { faculty = await prisma.faculty.create({ data: { name: row.facultyName, shortName: row.shortName || null, email: row.email || null } }); facultyCreated += 1; }
    await prisma.facultySubject.upsert({ where: { facultyId_subjectId: { facultyId: faculty.id, subjectId: subject.id } }, create: { facultyId: faculty.id, subjectId: subject.id }, update: {} });
    imported += 1;
  }
  return { rowsRead: rows.length, mappingsImported: imported, facultyCreated, skipped: errors.length, errors };
}

