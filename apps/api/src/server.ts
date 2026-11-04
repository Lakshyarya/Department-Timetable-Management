import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { importEntity, importFacultySubjects } from "./imports.js";
import { csv, pdf, reportRows, xlsx } from "./exports.js";
import { openAiCandidate } from "./ai.js";
import { z } from "zod";

dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
import { applyCandidate, assessFeasibility, generateHeuristicCandidate, projectBackup, prisma, restoreProject, validateSessionCandidate, type SessionInput } from "./timetable.js";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true }));
app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");
app.use((_request, response, next) => { response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("X-Frame-Options", "DENY"); response.setHeader("Referrer-Policy", "no-referrer"); next(); });
const requestWindows = new Map<string, { started: number; count: number }>();
app.use((request, response, next) => { const key = request.ip ?? "unknown"; const now = Date.now(); const current = requestWindows.get(key); const entry = !current || now - current.started > 60_000 ? { started: now, count: 1 } : { ...current, count: current.count + 1 }; requestWindows.set(key, entry); if (entry.count > 240) return response.status(429).json({ error: "Too many requests. Try again in a minute." }); next(); });

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "dca-timetable-api" });
});

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (request, response, next) =>
  Promise.resolve(handler(request, response, next)).catch(next);
const sessionSchema = z.object({ semesterId: z.string().min(1), programId: z.string().min(1), yearId: z.string().min(1), day: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), subjectId: z.string().min(1), teacherId: z.string().min(1), roomId: z.string().min(1), sectionIds: z.array(z.string().min(1)).min(1), durationPeriods: z.number().int().positive(), isLocked: z.boolean().optional(), notes: z.string().max(1000).optional() });

app.get("/api/academic-years", asyncRoute(async (_request, response) => response.json(await prisma.academicYear.findMany({ orderBy: { name: "desc" } }))));
app.post("/api/academic-years", asyncRoute(async (request, response) => response.status(201).json(await prisma.academicYear.create({ data: { name: String(request.body.name) } }))));
app.put("/api/academic-years/:id", asyncRoute(async (request, response) => response.json(await prisma.academicYear.update({ where: { id: String(request.params.id) }, data: { name: String(request.body.name) } }))));
app.delete("/api/academic-years/:id", asyncRoute(async (request, response) => { await prisma.academicYear.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));
app.get("/api/programs", asyncRoute(async (_request, response) => response.json(await prisma.program.findMany({ orderBy: { name: "asc" } }))));
app.post("/api/programs", asyncRoute(async (request, response) => response.status(201).json(await prisma.program.create({ data: { name: String(request.body.name) } }))));
app.put("/api/programs/:id", asyncRoute(async (request, response) => response.json(await prisma.program.update({ where: { id: String(request.params.id) }, data: { name: String(request.body.name) } }))));
app.delete("/api/programs/:id", asyncRoute(async (request, response) => { await prisma.program.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));

app.get("/api/years", asyncRoute(async (request, response) => response.json(await prisma.year.findMany({ where: request.query.programId ? { programId: String(request.query.programId) } : undefined, include: { program: true }, orderBy: { name: "asc" } }))));
app.post("/api/years", asyncRoute(async (request, response) => response.status(201).json(await prisma.year.create({ data: { name: String(request.body.name), programId: String(request.body.programId) } }))));
app.put("/api/years/:id", asyncRoute(async (request, response) => response.json(await prisma.year.update({ where: { id: String(request.params.id) }, data: { name: String(request.body.name), programId: String(request.body.programId) } }))));
app.delete("/api/years/:id", asyncRoute(async (request, response) => { await prisma.year.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));
app.get("/api/semesters", asyncRoute(async (request, response) => response.json(await prisma.semester.findMany({ where: request.query.academicYearId ? { academicYearId: String(request.query.academicYearId) } : undefined, include: { academicYear: true }, orderBy: { name: "asc" } }))));
app.post("/api/semesters", asyncRoute(async (request, response) => response.status(201).json(await prisma.semester.create({ data: { name: String(request.body.name), academicYearId: String(request.body.academicYearId) } }))));
app.put("/api/semesters/:id", asyncRoute(async (request, response) => response.json(await prisma.semester.update({ where: { id: String(request.params.id) }, data: { name: String(request.body.name), academicYearId: String(request.body.academicYearId) } }))));
app.delete("/api/semesters/:id", asyncRoute(async (request, response) => { await prisma.semester.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));

app.get("/api/faculty", asyncRoute(async (_request, response) => response.json(await prisma.faculty.findMany({ include: { mappings: true }, orderBy: { name: "asc" } }))));
app.post("/api/faculty", asyncRoute(async (request, response) => response.status(201).json(await prisma.faculty.create({ data: { name: String(request.body.name), shortName: request.body.shortName || null, email: request.body.email || null } }))));
app.put("/api/faculty/:id", asyncRoute(async (request, response) => response.json(await prisma.faculty.update({ where: { id: String(request.params.id) }, data: { name: String(request.body.name), shortName: request.body.shortName || null, email: request.body.email || null } }))));
app.delete("/api/faculty/:id", asyncRoute(async (request, response) => { await prisma.faculty.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));
app.post("/api/faculty/:id/subjects", asyncRoute(async (request, response) => response.status(201).json(await prisma.facultySubject.upsert({ where: { facultyId_subjectId: { facultyId: String(request.params.id), subjectId: String(request.body.subjectId) } }, create: { facultyId: String(request.params.id), subjectId: String(request.body.subjectId) }, update: {} }))));
app.post("/api/import/faculty-subjects", express.text({ type: ["text/csv", "text/plain"] }), asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? "");
  if (!semesterId) return response.status(400).json({ error: "semesterId query parameter is required" });
  const csv = typeof request.body === "string" ? request.body : String(request.body.csv ?? "");
  response.json(await importFacultySubjects(semesterId, csv));
}));
app.post("/api/import/:entity", express.text({ type: ["text/csv", "text/plain"] }), asyncRoute(async (request, response) => {
  const entity = String(request.params.entity); if (!(["rooms", "sections", "subjects"] as string[]).includes(entity)) return response.status(400).json({ error: "entity must be rooms, sections, or subjects" });
  response.json(await importEntity(entity as "rooms" | "sections" | "subjects", String(request.body ?? "")));
}));
app.get("/api/rooms", asyncRoute(async (_request, response) => response.json(await prisma.room.findMany({ orderBy: { name: "asc" } }))));
app.post("/api/rooms", asyncRoute(async (request, response) => response.status(201).json(await prisma.room.create({ data: { name: String(request.body.name), type: request.body.type, capacity: Number(request.body.capacity) } }))));
app.put("/api/rooms/:id", asyncRoute(async (request, response) => response.json(await prisma.room.update({ where: { id: String(request.params.id) }, data: { name: String(request.body.name), type: request.body.type, capacity: Number(request.body.capacity) } }))));
app.delete("/api/rooms/:id", asyncRoute(async (request, response) => { await prisma.room.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));

app.get("/api/subjects", asyncRoute(async (request, response) => response.json(await prisma.subject.findMany({ where: request.query.semesterId ? { semesterId: String(request.query.semesterId) } : undefined, orderBy: { code: "asc" } }))));
app.post("/api/subjects", asyncRoute(async (request, response) => response.status(201).json(await prisma.subject.create({ data: { code: String(request.body.code), name: String(request.body.name), type: request.body.type, weeklyHours: Number(request.body.weeklyHours), durationPeriods: Number(request.body.durationPeriods), programId: String(request.body.programId), yearId: String(request.body.yearId), semesterId: String(request.body.semesterId) } }))));
app.put("/api/subjects/:id", asyncRoute(async (request, response) => response.json(await prisma.subject.update({ where: { id: String(request.params.id) }, data: { code: String(request.body.code), name: String(request.body.name), type: request.body.type, weeklyHours: Number(request.body.weeklyHours), durationPeriods: Number(request.body.durationPeriods), programId: String(request.body.programId), yearId: String(request.body.yearId), semesterId: String(request.body.semesterId) } }))));
app.delete("/api/subjects/:id", asyncRoute(async (request, response) => { await prisma.subject.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));
app.get("/api/sections", asyncRoute(async (request, response) => response.json(await prisma.section.findMany({ where: request.query.semesterId ? { semesterId: String(request.query.semesterId) } : undefined, orderBy: { name: "asc" } }))));
app.post("/api/sections", asyncRoute(async (request, response) => response.status(201).json(await prisma.section.create({ data: { name: String(request.body.name), strength: Number(request.body.strength), programId: String(request.body.programId), yearId: String(request.body.yearId), semesterId: String(request.body.semesterId) } }))));
app.put("/api/sections/:id", asyncRoute(async (request, response) => response.json(await prisma.section.update({ where: { id: String(request.params.id) }, data: { name: String(request.body.name), strength: Number(request.body.strength), programId: String(request.body.programId), yearId: String(request.body.yearId), semesterId: String(request.body.semesterId) } }))));
app.delete("/api/sections/:id", asyncRoute(async (request, response) => { await prisma.section.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));
app.get("/api/sections/:id/coordinators", asyncRoute(async (request, response) => response.json(await prisma.classCoordinator.findMany({ where: { sectionId: String(request.params.id) }, include: { faculty: true } }))));
app.post("/api/sections/:id/coordinators", asyncRoute(async (request, response) => response.status(201).json(await prisma.classCoordinator.upsert({ where: { sectionId_facultyId: { sectionId: String(request.params.id), facultyId: String(request.body.facultyId) } }, create: { sectionId: String(request.params.id), facultyId: String(request.body.facultyId), mobile: request.body.mobile || null }, update: { mobile: request.body.mobile || null } }))));
app.get("/api/sections/:id/subjects", asyncRoute(async (request, response) => response.json(await prisma.sectionSubject.findMany({ where: { sectionId: String(request.params.id) }, include: { subject: true } }))));
app.post("/api/sections/:id/subjects", asyncRoute(async (request, response) => response.status(201).json(await prisma.sectionSubject.upsert({ where: { sectionId_subjectId: { sectionId: String(request.params.id), subjectId: String(request.body.subjectId) } }, create: { sectionId: String(request.params.id), subjectId: String(request.body.subjectId) }, update: {} }))));
app.delete("/api/sections/:id/subjects/:subjectId", asyncRoute(async (request, response) => { await prisma.sectionSubject.delete({ where: { sectionId_subjectId: { sectionId: String(request.params.id), subjectId: String(request.params.subjectId) } } }); response.status(204).end(); }));
app.get("/api/time-slots", asyncRoute(async (_request, response) => response.json(await prisma.timeSlot.findMany({ orderBy: [{ day: "asc" }, { periodNumber: "asc" }] }))));
app.post("/api/time-slots", asyncRoute(async (request, response) => response.status(201).json(await prisma.timeSlot.create({ data: { day: request.body.day, startTime: String(request.body.startTime), endTime: String(request.body.endTime), periodNumber: Number(request.body.periodNumber), isTeaching: Boolean(request.body.isTeaching) } }))));
app.put("/api/time-slots/:id", asyncRoute(async (request, response) => response.json(await prisma.timeSlot.update({ where: { id: String(request.params.id) }, data: { day: request.body.day, startTime: String(request.body.startTime), endTime: String(request.body.endTime), periodNumber: Number(request.body.periodNumber), isTeaching: Boolean(request.body.isTeaching) } }))));
app.delete("/api/time-slots/:id", asyncRoute(async (request, response) => { await prisma.timeSlot.delete({ where: { id: String(request.params.id) } }); response.status(204).end(); }));
app.get("/api/faculty/:id/availability", asyncRoute(async (request, response) => response.json(await prisma.facultyAvailability.findMany({ where: { facultyId: String(request.params.id) } }))));
app.post("/api/faculty/:id/availability", asyncRoute(async (request, response) => response.status(201).json(await prisma.facultyAvailability.create({ data: { facultyId: String(request.params.id), day: request.body.day, startTime: String(request.body.startTime), endTime: String(request.body.endTime), status: request.body.status } }))));
app.put("/api/faculty/:id/availability/:availabilityId", asyncRoute(async (request, response) => response.json(await prisma.facultyAvailability.update({ where: { id: String(request.params.availabilityId) }, data: { day: request.body.day, startTime: String(request.body.startTime), endTime: String(request.body.endTime), status: request.body.status } }))));
app.delete("/api/faculty/:id/availability/:availabilityId", asyncRoute(async (request, response) => { await prisma.facultyAvailability.delete({ where: { id: String(request.params.availabilityId) } }); response.status(204).end(); }));
app.get("/api/rooms/:id/availability", asyncRoute(async (request, response) => response.json(await prisma.roomAvailability.findMany({ where: { roomId: String(request.params.id) } }))));
app.post("/api/rooms/:id/availability", asyncRoute(async (request, response) => response.status(201).json(await prisma.roomAvailability.create({ data: { roomId: String(request.params.id), day: request.body.day, startTime: String(request.body.startTime), endTime: String(request.body.endTime), status: request.body.status } }))));
app.put("/api/rooms/:id/availability/:availabilityId", asyncRoute(async (request, response) => response.json(await prisma.roomAvailability.update({ where: { id: String(request.params.availabilityId) }, data: { day: request.body.day, startTime: String(request.body.startTime), endTime: String(request.body.endTime), status: request.body.status } }))));
app.delete("/api/rooms/:id/availability/:availabilityId", asyncRoute(async (request, response) => { await prisma.roomAvailability.delete({ where: { id: String(request.params.availabilityId) } }); response.status(204).end(); }));

app.get("/api/timetable", asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? "");
  if (!semesterId) return response.status(400).json({ error: "semesterId is required" });
  const facultyId = request.query.facultyId ? String(request.query.facultyId) : undefined; const roomId = request.query.roomId ? String(request.query.roomId) : undefined; const sectionId = request.query.sectionId ? String(request.query.sectionId) : undefined;
  response.json(await prisma.timetableSession.findMany({ where: { semesterId, ...(facultyId ? { teacherId: facultyId } : {}), ...(roomId ? { roomId } : {}), ...(sectionId ? { sections: { some: { sectionId } } } : {}) }, include: { sections: { include: { section: true } }, subject: true, teacher: true, room: true }, orderBy: [{ day: "asc" }, { startTime: "asc" }] }));
}));

app.get("/api/timetable/context", asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? "");
  if (!semesterId) return response.status(400).json({ error: "semesterId is required" });
  const [sections, subjects, faculty, rooms] = await Promise.all([
    prisma.section.findMany({ where: { semesterId }, orderBy: { name: "asc" } }),
    prisma.subject.findMany({ where: { semesterId }, orderBy: { code: "asc" } }),
    prisma.faculty.findMany({ orderBy: { name: "asc" } }),
    prisma.room.findMany({ orderBy: { name: "asc" } }),
  ]);
  response.json({ sections, subjects, faculty, rooms });
}));

app.post("/api/timetable/validate", asyncRoute(async (request, response) => {
  const parsed = sessionSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid session payload", details: parsed.error.flatten() }); const result = await validateSessionCandidate(parsed.data as SessionInput);
  response.json(result);
}));
app.post("/api/timetable/generate", asyncRoute(async (request, response) => {
  const semesterId = String(request.body.semesterId ?? "");
  if (!semesterId) return response.status(400).json({ error: "semesterId is required" });
  if (request.body.provider === "openai") return response.json(await openAiCandidate(semesterId));
  response.json({ status: "candidate", provider: "deterministic-heuristic", ...(await generateHeuristicCandidate(semesterId, request.body.sectionIds)) });
}));
app.post("/api/timetable/apply-candidate", asyncRoute(async (request, response) => {
  const semesterId = String(request.body.semesterId ?? ""); if (!semesterId || !Array.isArray(request.body.sessions)) return response.status(400).json({ error: "semesterId and sessions are required" });
  const result = await applyCandidate(semesterId, request.body.sessions); response.status(result.applied ? 201 : 422).json(result);
}));
app.get("/api/timetable/feasibility", asyncRoute(async (request, response) => { const semesterId = String(request.query.semesterId ?? ""); if (!semesterId) return response.status(400).json({ error: "semesterId is required" }); response.json(await assessFeasibility(semesterId)); }));
app.get("/api/reports/validation", asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? "");
  if (!semesterId) return response.status(400).json({ error: "semesterId is required" });
  const sessions = await prisma.timetableSession.findMany({ where: { semesterId }, include: { sections: true } });
  const context = await (await import("./timetable.js")).loadValidationContext(semesterId);
  response.json((await import("@dca/validator")).validateTimetable(context, sessions.map((entry) => ({ id: entry.id, day: entry.day as never, startTime: entry.startTime, endTime: entry.endTime, subjectId: entry.subjectId, teacherId: entry.teacherId, roomId: entry.roomId, sectionIds: entry.sections.map(s => s.sectionId), durationPeriods: entry.durationPeriods, isLocked: entry.isLocked, notes: entry.notes ?? undefined })), { checkCompleteness: true }));
}));
app.get("/api/reports/workload", asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? ""); if (!semesterId) return response.status(400).json({ error: "semesterId is required" });
  const sessions = await prisma.timetableSession.findMany({ where: { semesterId }, include: { teacher: true } }); const totals = new Map<string, { facultyId: string; faculty: string; hours: number; sessions: number }>();
  for (const session of sessions) { const entry = totals.get(session.teacherId) ?? { facultyId: session.teacherId, faculty: session.teacher.name, hours: 0, sessions: 0 }; entry.hours += (Number(session.endTime.slice(0, 2)) * 60 + Number(session.endTime.slice(3))) / 60 - (Number(session.startTime.slice(0, 2)) * 60 + Number(session.startTime.slice(3))) / 60; entry.sessions += 1; totals.set(session.teacherId, entry); }
  response.json([...totals.values()].sort((a, b) => b.hours - a.hours));
}));
app.get("/api/reports/room-utilization", asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? ""); if (!semesterId) return response.status(400).json({ error: "semesterId is required" }); const sessions = await prisma.timetableSession.findMany({ where: { semesterId }, include: { room: true } }); const totals = new Map<string, { roomId: string; room: string; type: string; hours: number; sessions: number }>();
  for (const session of sessions) { const entry = totals.get(session.roomId) ?? { roomId: session.roomId, room: session.room.name, type: session.room.type, hours: 0, sessions: 0 }; entry.hours += (Number(session.endTime.slice(0, 2)) * 60 + Number(session.endTime.slice(3))) / 60 - (Number(session.startTime.slice(0, 2)) * 60 + Number(session.startTime.slice(3))) / 60; entry.sessions += 1; totals.set(session.roomId, entry); }
  response.json([...totals.values()].sort((a, b) => b.hours - a.hours));
}));
app.get("/api/reports/subject-hours", asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? ""); if (!semesterId) return response.status(400).json({ error: "semesterId is required" });
  const [sections, subjects, sessions] = await Promise.all([prisma.section.findMany({ where: { semesterId }, include: { subjectMappings: { include: { subject: true } } } }), prisma.subject.findMany({ where: { semesterId } }), prisma.timetableSession.findMany({ where: { semesterId }, include: { sections: true } })]);
  const result = sections.flatMap((section) => (section.subjectMappings.length ? section.subjectMappings.map(mapping => mapping.subject) : subjects.filter(subject => subject.programId === section.programId && subject.yearId === section.yearId)).map((subject) => { const scheduled = sessions.filter(session => session.subjectId === subject.id && session.sections.some(link => link.sectionId === section.id)).reduce((hours, session) => hours + (Number(session.endTime.slice(0, 2)) * 60 + Number(session.endTime.slice(3)) - Number(session.startTime.slice(0, 2)) * 60 - Number(session.startTime.slice(3))) / 60, 0); return { sectionId: section.id, section: section.name, subjectId: subject.id, subject: subject.name, code: subject.code, requiredHours: subject.weeklyHours, scheduledHours: scheduled, remainingHours: subject.weeklyHours - scheduled }; }));
  response.json(result);
}));
app.get("/api/backup", asyncRoute(async (_request, response) => response.json(await projectBackup())));
app.get("/api/backup/download", asyncRoute(async (_request, response) => { response.header("Content-Disposition", "attachment; filename=timetable-project.json").json(await projectBackup()); }));
app.post("/api/restore", asyncRoute(async (request, response) => response.json(await restoreProject(request.body))));
app.get("/api/dashboard", asyncRoute(async (request, response) => {
  const semesterId = request.query.semesterId ? String(request.query.semesterId) : undefined;
  const [academicYears, sections, subjects, faculty, rooms, sessions] = await Promise.all([prisma.academicYear.count(), prisma.section.count({ where: semesterId ? { semesterId } : undefined }), prisma.subject.count({ where: semesterId ? { semesterId } : undefined }), prisma.faculty.count(), prisma.room.count(), prisma.timetableSession.count({ where: semesterId ? { semesterId } : undefined })]);
  response.json({ academicYears, sections, subjects, faculty, rooms, sessions });
}));
app.get("/api/search", asyncRoute(async (request, response) => {
  const query = String(request.query.q ?? "").trim(); if (!query) return response.json({ faculty: [], subjects: [], sections: [], rooms: [] });
  const where = { contains: query, mode: "insensitive" as const };
  const [faculty, subjects, sections, rooms] = await Promise.all([prisma.faculty.findMany({ where: { name: where }, take: 15 }), prisma.subject.findMany({ where: { OR: [{ name: where }, { code: where }] }, take: 15 }), prisma.section.findMany({ where: { name: where }, take: 15 }), prisma.room.findMany({ where: { name: where }, take: 15 })]);
  response.json({ faculty, subjects, sections, rooms });
}));
app.get("/api/settings", asyncRoute(async (_request, response) => response.json(await prisma.applicationSetting.findMany({ orderBy: { key: "asc" } }))));
app.put("/api/settings/:key", asyncRoute(async (request, response) => response.json(await prisma.applicationSetting.upsert({ where: { key: String(request.params.key) }, create: { key: String(request.params.key), value: request.body.value }, update: { value: request.body.value } }))));
app.get("/api/export/:format", asyncRoute(async (request, response) => {
  const semesterId = String(request.query.semesterId ?? ""); if (!semesterId) return response.status(400).json({ error: "semesterId is required" });
  const rows = await reportRows(semesterId, { sectionId: request.query.sectionId ? String(request.query.sectionId) : undefined, facultyId: request.query.facultyId ? String(request.query.facultyId) : undefined, roomId: request.query.roomId ? String(request.query.roomId) : undefined }); const format = String(request.params.format);
  if (format === "csv") { response.header("Content-Disposition", "attachment; filename=master-timetable.csv").type("text/csv").send(csv(rows)); return; }
  if (format === "xlsx") { response.header("Content-Disposition", "attachment; filename=master-timetable.xlsx").type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(await xlsx(rows)); return; }
  if (format === "pdf") { response.header("Content-Disposition", "attachment; filename=master-timetable.pdf").type("application/pdf").send(await pdf(rows)); return; }
  response.status(400).json({ error: "format must be csv, xlsx, or pdf" });
}));

app.post("/api/timetable/sessions", asyncRoute(async (request, response) => {
  const parsed = sessionSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid session payload", details: parsed.error.flatten() }); const input = parsed.data as SessionInput;
  const validation = await validateSessionCandidate(input);
  if (!validation.valid) return response.status(422).json(validation);
  const session = await prisma.timetableSession.create({
    data: { semesterId: input.semesterId, programId: input.programId, yearId: input.yearId, day: input.day, startTime: input.startTime, endTime: input.endTime, subjectId: input.subjectId, teacherId: input.teacherId, roomId: input.roomId, durationPeriods: input.durationPeriods, isLocked: input.isLocked ?? false, notes: input.notes ?? null, sections: { create: input.sectionIds.map((sectionId) => ({ sectionId })) } },
    include: { sections: true },
  });
  response.status(201).json(session);
}));

app.put("/api/timetable/sessions/:id", asyncRoute(async (request, response) => {
  const id = String(request.params.id);
  const parsed = sessionSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid session payload", details: parsed.error.flatten() }); const input = { ...parsed.data as SessionInput, id };
  const validation = await validateSessionCandidate(input);
  if (!validation.valid) return response.status(422).json(validation);
  const session = await prisma.timetableSession.update({ where: { id }, data: { day: input.day, startTime: input.startTime, endTime: input.endTime, subjectId: input.subjectId, teacherId: input.teacherId, roomId: input.roomId, durationPeriods: input.durationPeriods, isLocked: input.isLocked ?? false, notes: input.notes ?? null, sections: { deleteMany: {}, create: input.sectionIds.map((sectionId) => ({ sectionId })) } }, include: { sections: true } });
  response.json(session);
}));

app.delete("/api/timetable/sessions/:id", asyncRoute(async (request, response) => {
  await prisma.timetableSession.delete({ where: { id: String(request.params.id) } });
  response.status(204).end();
}));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Unexpected server error" });
});

const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => console.log(`DCA timetable API listening on port ${port}`));
