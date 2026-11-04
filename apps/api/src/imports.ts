import { prisma } from "./timetable.js";

type ImportRow = { facultyName?: string; shortName?: string; email?: string; subjectCode?: string; [key: string]: string | undefined };

export const parseCsv = (text: string): ImportRow[] => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const read = (line: string) => line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
  const headers = read(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  return lines.slice(1).map((line) => {
    const values = read(line); const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] || undefined])); const at = (names: string[]) => names.map((name) => raw[name]).find(Boolean);
    return { ...raw, facultyName: at(["facultyname", "teachername", "name"]), shortName: at(["shortname", "initials"]), email: at(["email"]), subjectCode: at(["subjectcode", "code"]) };
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

export async function importEntity(entity: "rooms" | "sections" | "subjects", csv: string) {
  const rows = parseCsv(csv) as Array<Record<string, string>>; let imported = 0; const errors: { row: number; message: string }[] = [];
  for (const [index, row] of rows.entries()) try {
    if (entity === "rooms") { if (!row.facultyName && !row.name) throw new Error("name is required."); await prisma.room.create({ data: { name: row.name ?? row.facultyName!, type: (row.type ?? "CLASSROOM") as never, capacity: Number(row.capacity ?? 0) } }); }
    if (entity === "sections") { if (!row.name || !row.programid || !row.yearid || !row.semesterid) throw new Error("name, programId, yearId, and semesterId are required."); await prisma.section.create({ data: { name: row.name, strength: Number(row.strength ?? 0), programId: row.programid, yearId: row.yearid, semesterId: row.semesterid } }); }
    if (entity === "subjects") { if (!row.code || !row.name || !row.programid || !row.yearid || !row.semesterid) throw new Error("code, name, programId, yearId, and semesterId are required."); await prisma.subject.create({ data: { code: row.code, name: row.name, type: (row.type ?? "THEORY") as never, weeklyHours: Number(row.weeklyhours ?? 0), durationPeriods: Number(row.durationperiods ?? 1), programId: row.programid, yearId: row.yearid, semesterId: row.semesterid } }); }
    imported += 1;
  } catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : "Invalid row." }); }
  return { rowsRead: rows.length, imported, skipped: errors.length, errors };
}

