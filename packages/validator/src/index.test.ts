import { describe, expect, it } from "vitest";
import { facultySubjectKey, type TimetableSession, type ValidationContext } from "@dca/domain";
import { validateTimetable } from "./index.js";

const context: ValidationContext = {
  workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
  periodMinutes: 60,
  sections: [{ id: "a", name: "BCA 1-A", strength: 50 }, { id: "b", name: "BCA 1-B", strength: 45 }],
  subjects: [
    { id: "dbms", code: "BCA101", name: "DBMS", type: "THEORY", weeklyHours: 4, durationPeriods: 1 },
    { id: "os", code: "BCA102", name: "Operating Systems", type: "THEORY", weeklyHours: 4, durationPeriods: 1 },
    { id: "lab", code: "BCA103", name: "Programming Lab", type: "PRACTICAL", weeklyHours: 2, durationPeriods: 2 },
  ],
  rooms: [{ id: "lt", name: "LT-01", type: "LECTURE_THEATRE", capacity: 120 }, { id: "cr-1", name: "CR-101", type: "CLASSROOM", capacity: 60 }, { id: "lab-1", name: "Lab 1", type: "LAB", capacity: 60 }],
  facultySubjectPairs: new Set([facultySubjectKey("sharma", "dbms"), facultySubjectKey("sharma", "os"), facultySubjectKey("sharma", "lab")]),
  teacherAvailability: [], roomAvailability: [], breaks: [],
};

const session = (overrides: Partial<TimetableSession> = {}): TimetableSession => ({
  id: "one", day: "MONDAY", startTime: "09:00", endTime: "10:00", subjectId: "dbms", teacherId: "sharma", roomId: "lt", sectionIds: ["a"], durationPeriods: 1, ...overrides,
});

describe("validateTimetable", () => {
  it("allows the same teacher and subject to teach multiple sections concurrently", () => {
    const result = validateTimetable(context, [session(), session({ id: "two", roomId: "cr-1", sectionIds: ["b"] })]);
    expect(result.valid).toBe(true);
  });

  it("rejects a teacher teaching different subjects at the same time", () => {
    const result = validateTimetable(context, [session(), session({ id: "two", subjectId: "os", sectionIds: ["b"] })]);
    expect(result.issues.map((entry) => entry.code)).toContain("TEACHER_OVERLAP");
  });

  it("rejects a practical that does not reserve its configured consecutive periods", () => {
    const result = validateTimetable(context, [session({ subjectId: "lab", roomId: "lab-1", endTime: "10:00", durationPeriods: 1 })]);
    expect(result.issues.map((entry) => entry.code)).toContain("INVALID_DURATION");
  });

  it("rejects overlapping use of the same room even when teachers differ", () => {
    const changedContext = { ...context, facultySubjectPairs: new Set([...context.facultySubjectPairs, facultySubjectKey("verma", "os")]) };
    const result = validateTimetable(changedContext, [session(), session({ id: "two", subjectId: "os", teacherId: "verma", sectionIds: ["b"] })]);
    expect(result.issues.map((entry) => entry.code)).toContain("ROOM_OVERLAP");
  });
});
