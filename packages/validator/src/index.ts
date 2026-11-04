import {
  facultySubjectKey,
  type AvailabilityRule,
  type ConflictCode,
  type Id,
  type RoomType,
  type TimetableSession,
  type ValidationContext,
  type ValidationIssue,
  type ValidationResult,
} from "@dca/domain";

const toMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const overlaps = (
  left: Pick<TimetableSession, "day" | "startTime" | "endTime">,
  right: Pick<TimetableSession, "day" | "startTime" | "endTime">,
) => left.day === right.day && toMinutes(left.startTime) < toMinutes(right.endTime) && toMinutes(right.startTime) < toMinutes(left.endTime);

const permittedRoomTypes = (subjectType: string): RoomType[] => {
  if (subjectType === "PRACTICAL") return ["LAB"];
  if (subjectType === "SEMINAR") return ["CLASSROOM", "LECTURE_THEATRE", "SEMINAR_HALL"];
  return ["CLASSROOM", "LECTURE_THEATRE"];
};

const isUnavailable = (rules: readonly AvailabilityRule[], resourceId: Id, session: TimetableSession) =>
  rules.some(
    (rule) =>
      rule.resourceId === resourceId &&
      rule.status === "UNAVAILABLE" &&
      overlaps(session, rule),
  );

function issue(
  issues: ValidationIssue[],
  code: ConflictCode,
  session: TimetableSession,
  message: string,
  resourceId?: Id,
  relatedSessionIds?: Id[],
) {
  issues.push({ code, sessionId: session.id, message, resourceId, relatedSessionIds });
}

/**
 * The sole conflict authority for manual edits, imports, solver output and AI candidates.
 * Same teacher + same subject may overlap; it never relaxes section or room constraints.
 */
export function validateTimetable(
  context: ValidationContext,
  sessions: readonly TimetableSession[],
  options: { checkCompleteness?: boolean } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const sections = new Map(context.sections.map((entry) => [entry.id, entry]));
  const subjects = new Map(context.subjects.map((entry) => [entry.id, entry]));
  const rooms = new Map(context.rooms.map((entry) => [entry.id, entry]));

  for (const session of sessions) {
    const subject = subjects.get(session.subjectId);
    const room = rooms.get(session.roomId);
    const sessionSections = session.sectionIds.map((id) => sections.get(id)).filter(Boolean);
    const duration = toMinutes(session.endTime) - toMinutes(session.startTime);

    if (duration <= 0) issue(issues, "INVALID_TIME_RANGE", session, "End time must be after start time.");
    if (!context.workingDays.includes(session.day)) issue(issues, "NON_WORKING_DAY", session, `${session.day} is not a configured working day.`);
    if (context.breaks.some((breakRange) => overlaps(session, breakRange))) issue(issues, "BREAK_OVERLAP", session, "Teaching sessions cannot overlap a break or lunch interval.");
    if (!subject) continue;
    if (!room) continue;

    if (!context.facultySubjectPairs.has(facultySubjectKey(session.teacherId, session.subjectId))) {
      issue(issues, "UNMAPPED_TEACHER_SUBJECT", session, "Faculty is not mapped to this subject for the active academic context.", session.teacherId);
    }
    if (isUnavailable(context.teacherAvailability, session.teacherId, session)) {
      issue(issues, "TEACHER_UNAVAILABLE", session, "Faculty is unavailable during this session.", session.teacherId);
    }
    if (isUnavailable(context.roomAvailability, room.id, session)) {
      issue(issues, "ROOM_UNAVAILABLE", session, "Room is unavailable during this session.", room.id);
    }

    const allowedTypes = subject.permittedRoomTypes ?? permittedRoomTypes(subject.type);
    if (!allowedTypes.includes(room.type)) issue(issues, "INCOMPATIBLE_ROOM_TYPE", session, `${subject.type} cannot be scheduled in a ${room.type}.`, room.id);
    const combinedStrength = sessionSections.reduce((total, entry) => total + (entry?.strength ?? 0), 0);
    if (combinedStrength > room.capacity) issue(issues, "INSUFFICIENT_ROOM_CAPACITY", session, `Combined section strength ${combinedStrength} exceeds room capacity ${room.capacity}.`, room.id);
    if (duration !== session.durationPeriods * context.periodMinutes || session.durationPeriods !== subject.durationPeriods) {
      issue(issues, "INVALID_DURATION", session, "Session duration must match the configured consecutive-period requirement.");
    }
  }

  for (let index = 0; index < sessions.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < sessions.length; otherIndex += 1) {
      const current = sessions[index];
      const other = sessions[otherIndex];
      if (!overlaps(current, other)) continue;
      const related = [other.id];
      if (current.sectionIds.some((id) => other.sectionIds.includes(id))) {
        issue(issues, "SECTION_OVERLAP", current, "A section cannot attend two sessions at the same time.", undefined, related);
      }
      if (current.roomId === other.roomId) issue(issues, "ROOM_OVERLAP", current, "A room cannot host independent overlapping sessions.", current.roomId, related);
      if (current.teacherId === other.teacherId && current.subjectId !== other.subjectId) {
        issue(issues, "TEACHER_OVERLAP", current, "A faculty member cannot teach different subjects simultaneously.", current.teacherId, related);
      }
    }
  }

  if (options.checkCompleteness) {
    for (const section of context.sections) {
      for (const subject of context.subjects) {
        const scheduledHours = sessions
          .filter((session) => session.subjectId === subject.id && session.sectionIds.includes(section.id))
          .reduce((total, session) => total + (toMinutes(session.endTime) - toMinutes(session.startTime)) / 60, 0);
        if (scheduledHours > subject.weeklyHours) issue(issues, "SUBJECT_HOURS_EXCEEDED", { id: `${section.id}:${subject.id}`, day: "MONDAY", startTime: "00:00", endTime: "00:00", subjectId: subject.id, teacherId: "", roomId: "", sectionIds: [section.id], durationPeriods: 0 }, `${section.name}: ${subject.name} exceeds weekly requirement by ${scheduledHours - subject.weeklyHours} hour(s).`);
        if (scheduledHours < subject.weeklyHours) issue(issues, "SUBJECT_HOURS_INCOMPLETE", { id: `${section.id}:${subject.id}`, day: "MONDAY", startTime: "00:00", endTime: "00:00", subjectId: subject.id, teacherId: "", roomId: "", sectionIds: [section.id], durationPeriods: 0 }, `${section.name}: ${subject.name} has ${subject.weeklyHours - scheduledHours} hour(s) remaining.`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

