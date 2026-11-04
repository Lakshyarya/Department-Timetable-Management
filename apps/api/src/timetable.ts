import { PrismaClient } from "@prisma/client";
import { facultySubjectKey, type TimetableSession, type ValidationContext } from "@dca/domain";
import { validateTimetable } from "@dca/validator";

const prisma = new PrismaClient();

type SessionInput = Omit<TimetableSession, "id"> & { id?: string; semesterId: string; programId: string; yearId: string };

function asSession(session: {
  id: string; day: string; startTime: string; endTime: string; subjectId: string; teacherId: string; roomId: string; durationPeriods: number; isLocked: boolean; notes: string | null; sections: { sectionId: string }[];
}): TimetableSession {
  return {
    id: session.id,
    day: session.day as TimetableSession["day"],
    startTime: session.startTime,
    endTime: session.endTime,
    subjectId: session.subjectId,
    teacherId: session.teacherId,
    roomId: session.roomId,
    sectionIds: session.sections.map((entry) => entry.sectionId),
    durationPeriods: session.durationPeriods,
    isLocked: session.isLocked,
    notes: session.notes ?? undefined,
  };
}

export async function loadValidationContext(semesterId: string): Promise<ValidationContext> {
  const [sections, subjects, rooms, facultyMappings, teacherAvailability, roomAvailability, timeSlots] = await Promise.all([
    prisma.section.findMany({ where: { semesterId }, select: { id: true, name: true, strength: true } }),
    prisma.subject.findMany({ where: { semesterId }, select: { id: true, code: true, name: true, type: true, weeklyHours: true, durationPeriods: true } }),
    prisma.room.findMany({ select: { id: true, name: true, type: true, capacity: true } }),
    prisma.facultySubject.findMany({ where: { subject: { semesterId } }, select: { facultyId: true, subjectId: true } }),
    prisma.facultyAvailability.findMany(),
    prisma.roomAvailability.findMany(),
    prisma.timeSlot.findMany({ where: { isTeaching: false } }),
  ]);

  return {
    workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
    periodMinutes: 60,
    sections,
    subjects: subjects.map((subject) => ({ ...subject, type: subject.type as ValidationContext["subjects"][number]["type"] })),
    rooms: rooms.map((room) => ({ ...room, type: room.type as ValidationContext["rooms"][number]["type"] })),
    facultySubjectPairs: new Set(facultyMappings.map((entry) => facultySubjectKey(entry.facultyId, entry.subjectId))),
    teacherAvailability: teacherAvailability.map((rule) => ({ ...rule, day: rule.day as ValidationContext["workingDays"][number], status: rule.status as "AVAILABLE" | "UNAVAILABLE" | "PREFERRED" | "NOT_PREFERRED", resourceId: rule.facultyId })),
    roomAvailability: roomAvailability.map((rule) => ({ ...rule, day: rule.day as ValidationContext["workingDays"][number], status: rule.status as "AVAILABLE" | "UNAVAILABLE" | "PREFERRED" | "NOT_PREFERRED", resourceId: rule.roomId })),
    breaks: timeSlots.map((slot) => ({ day: slot.day as ValidationContext["workingDays"][number], startTime: slot.startTime, endTime: slot.endTime })),
  };
}

export async function validateSessionCandidate(input: SessionInput) {
  const [context, existing] = await Promise.all([
    loadValidationContext(input.semesterId),
    prisma.timetableSession.findMany({ where: { semesterId: input.semesterId, NOT: input.id ? { id: input.id } : undefined }, include: { sections: true } }),
  ]);

  const candidate: TimetableSession = {
    id: input.id ?? "candidate",
    day: input.day,
    startTime: input.startTime,
    endTime: input.endTime,
    subjectId: input.subjectId,
    teacherId: input.teacherId,
    roomId: input.roomId,
    sectionIds: input.sectionIds,
    durationPeriods: input.durationPeriods,
    isLocked: input.isLocked,
    notes: input.notes,
  };
  return validateTimetable(context, [...existing.map(asSession), candidate]);
}

export async function generateHeuristicCandidate(semesterId: string, sectionIds?: string[]) {
  const [context, mappings, targetSections, existingRows] = await Promise.all([
    loadValidationContext(semesterId),
    prisma.facultySubject.findMany({ where: { subject: { semesterId } } }),
    prisma.section.findMany({ where: { semesterId, id: sectionIds?.length ? { in: sectionIds } : undefined } }),
    prisma.timetableSession.findMany({ where: { semesterId }, include: { sections: true } }),
  ]);
  const subjects = await prisma.subject.findMany({ where: { semesterId } });
  const sectionSubjects = await prisma.sectionSubject.findMany({ where: { sectionId: { in: targetSections.map(section => section.id) } }, include: { subject: true } });
  const existing = existingRows.map(asSession); const sessions: TimetableSession[] = [];
  const slots = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00"];
  const days = context.workingDays;
  for (const section of targetSections) {
    const mappedSubjects = sectionSubjects.filter(mapping => mapping.sectionId === section.id).map(mapping => mapping.subject);
    const scheduledSubjects = mappedSubjects.length ? mappedSubjects : subjects.filter(s => s.programId === section.programId && s.yearId === section.yearId);
    for (const subject of scheduledSubjects) {
    const teacher = mappings.find(m => m.subjectId === subject.id)?.facultyId;
    const room = context.rooms.find(r => r.capacity >= section.strength && (subject.type === "PRACTICAL" ? r.type === "LAB" : r.type === "CLASSROOM" || r.type === "LECTURE_THEATRE"));
    if (!teacher || !room) continue;
    const alreadyScheduled = existing.filter(session => session.subjectId === subject.id && session.sectionIds.includes(section.id)).reduce((hours, session) => hours + (toHours(session.endTime) - toHours(session.startTime)), 0);
    const count = Math.max(0, Math.ceil((subject.weeklyHours - alreadyScheduled) / subject.durationPeriods));
    for (let index = 0; index < count; index++) {
      let chosen: TimetableSession | undefined;
      for (const day of days) for (const startTime of slots) {
        const start = Number(startTime.slice(0, 2)); const endTime = `${String(start + subject.durationPeriods).padStart(2, "0")}:00`;
        const candidate: TimetableSession = { id: `candidate-${section.id}-${subject.id}-${index}`, day, startTime, endTime, subjectId: subject.id, teacherId: teacher, roomId: room.id, sectionIds: [section.id], durationPeriods: subject.durationPeriods };
        if (validateTimetable(context, [...existing, ...sessions, candidate]).valid) { chosen = candidate; break; }
      if (chosen) break;
      }
      if (chosen) sessions.push(chosen);
    }
    }
  }
  return { sessions, validation: validateTimetable(context, [...existing, ...sessions], { checkCompleteness: true }) };
}

const toHours = (value: string) => Number(value.slice(0, 2)) + Number(value.slice(3)) / 60;

export async function projectBackup() {
  const [academicYears, programs, years, semesters, sections, subjects, faculty, rooms, timeSlots, sessions] = await Promise.all([
    prisma.academicYear.findMany(), prisma.program.findMany(), prisma.year.findMany(), prisma.semester.findMany(), prisma.section.findMany(), prisma.subject.findMany(), prisma.faculty.findMany({ include: { mappings: true, availability: true } }), prisma.room.findMany({ include: { availability: true } }), prisma.timeSlot.findMany(), prisma.timetableSession.findMany({ include: { sections: true } }),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), academicYears, programs, years, semesters, sections, subjects, faculty, rooms, timeSlots, sessions };
}

export async function applyCandidate(semesterId: string, candidates: TimetableSession[]) {
  const [context, existingRows, sections] = await Promise.all([loadValidationContext(semesterId), prisma.timetableSession.findMany({ where: { semesterId }, include: { sections: true } }), prisma.section.findMany({ where: { semesterId } })]);
  const validation = validateTimetable(context, [...existingRows.map(asSession), ...candidates]); if (!validation.valid) return { applied: false, validation };
  const saved = await prisma.$transaction(candidates.map((candidate) => {
    const section = sections.find(item => item.id === candidate.sectionIds[0]); if (!section) throw new Error("Candidate contains a section outside the active semester.");
    return prisma.timetableSession.create({ data: { semesterId, programId: section.programId, yearId: section.yearId, day: candidate.day, startTime: candidate.startTime, endTime: candidate.endTime, subjectId: candidate.subjectId, teacherId: candidate.teacherId, roomId: candidate.roomId, durationPeriods: candidate.durationPeriods, isLocked: false, notes: "Applied generated candidate", sections: { create: candidate.sectionIds.map(sectionId => ({ sectionId })) } } });
  }));
  return { applied: true, sessions: saved, validation };
}

export async function assessFeasibility(semesterId: string) {
  const [sections, subjects, slots, mappings, rooms] = await Promise.all([prisma.section.findMany({ where: { semesterId }, include: { subjectMappings: { include: { subject: true } } } }), prisma.subject.findMany({ where: { semesterId } }), prisma.timeSlot.findMany({ where: { isTeaching: true } }), prisma.facultySubject.findMany({ where: { subject: { semesterId } } }), prisma.room.findMany()]);
  const blockers: string[] = []; const totalRequiredHours = sections.reduce((total, section) => total + (section.subjectMappings.length ? section.subjectMappings.map(mapping => mapping.subject) : subjects.filter(subject => subject.programId === section.programId && subject.yearId === section.yearId)).reduce((hours, subject) => hours + subject.weeklyHours, 0), 0);
  const weeklySectionCapacity = sections.length * slots.length; if (totalRequiredHours > weeklySectionCapacity) blockers.push(`Required teaching hours (${totalRequiredHours}) exceed configured section-slot capacity (${weeklySectionCapacity}).`);
  for (const subject of subjects) { if (!mappings.some(mapping => mapping.subjectId === subject.id)) blockers.push(`${subject.code} has no mapped faculty member.`); if (subject.type === "PRACTICAL" && !rooms.some(room => room.type === "LAB")) blockers.push(`${subject.code} requires a lab, but no lab is configured.`); }
  return { feasible: blockers.length === 0, totalRequiredHours, weeklySectionCapacity, blockers };
}

export async function restoreProject(backup: any) {
  if (backup?.version !== 1 || !Array.isArray(backup.academicYears)) throw new Error("Unsupported or invalid backup file.");
  const required = ["programs", "years", "semesters", "sections", "subjects", "faculty", "rooms", "timeSlots", "sessions"];
  if (required.some((key) => !Array.isArray(backup[key]))) throw new Error("Backup is missing one or more required project collections.");
  await prisma.$transaction(async (db) => {
    await db.timetableSessionSection.deleteMany(); await db.timetableSession.deleteMany(); await db.classCoordinator.deleteMany(); await db.facultySubject.deleteMany();
    await db.facultyAvailability.deleteMany(); await db.roomAvailability.deleteMany(); await db.timeSlot.deleteMany(); await db.section.deleteMany(); await db.subject.deleteMany();
    await db.year.deleteMany(); await db.semester.deleteMany(); await db.program.deleteMany(); await db.academicYear.deleteMany(); await db.faculty.deleteMany(); await db.room.deleteMany();
    await db.academicYear.createMany({ data: backup.academicYears }); await db.program.createMany({ data: backup.programs }); await db.year.createMany({ data: backup.years }); await db.semester.createMany({ data: backup.semesters });
    await db.section.createMany({ data: backup.sections }); await db.subject.createMany({ data: backup.subjects });
    await db.faculty.createMany({ data: backup.faculty.map(({ mappings, availability, ...row }: any) => row) }); await db.room.createMany({ data: backup.rooms.map(({ availability, ...row }: any) => row) });
    await db.timeSlot.createMany({ data: backup.timeSlots });
    await db.facultySubject.createMany({ data: backup.faculty.flatMap((faculty: any) => faculty.mappings.map((mapping: any) => ({ facultyId: faculty.id, subjectId: mapping.subjectId }))) });
    await db.facultyAvailability.createMany({ data: backup.faculty.flatMap((faculty: any) => faculty.availability.map((rule: any) => ({ facultyId: faculty.id, day: rule.day, startTime: rule.startTime, endTime: rule.endTime, status: rule.status }))) });
    await db.roomAvailability.createMany({ data: backup.rooms.flatMap((room: any) => room.availability.map((rule: any) => ({ roomId: room.id, day: rule.day, startTime: rule.startTime, endTime: rule.endTime, status: rule.status }))) });
    for (const session of backup.sessions) { const { sections, ...row } = session; await db.timetableSession.create({ data: { ...row, sections: { create: sections.map((entry: any) => ({ sectionId: entry.sectionId })) } } }); }
  });
  return { restored: true };
}

export { prisma, type SessionInput };
