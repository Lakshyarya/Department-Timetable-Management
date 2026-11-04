export type Id = string;
export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export type SubjectType =
  | "THEORY"
  | "PRACTICAL"
  | "PROJECT"
  | "SEMINAR"
  | "VIVA"
  | "PBL"
  | "PLACEMENT"
  | "LIBRARY"
  | "TRAINING"
  | "OTHER";

export type RoomType =
  | "CLASSROOM"
  | "LAB"
  | "LECTURE_THEATRE"
  | "SEMINAR_HALL"
  | "CONFERENCE_HALL"
  | "AUDITORIUM"
  | "WORKSHOP"
  | "OTHER";

export type AvailabilityStatus = "AVAILABLE" | "UNAVAILABLE" | "PREFERRED" | "NOT_PREFERRED";
export type ConflictCode =
  | "INVALID_TIME_RANGE"
  | "NON_WORKING_DAY"
  | "BREAK_OVERLAP"
  | "SECTION_OVERLAP"
  | "TEACHER_OVERLAP"
  | "ROOM_OVERLAP"
  | "TEACHER_UNAVAILABLE"
  | "ROOM_UNAVAILABLE"
  | "UNMAPPED_TEACHER_SUBJECT"
  | "INCOMPATIBLE_ROOM_TYPE"
  | "INSUFFICIENT_ROOM_CAPACITY"
  | "INVALID_DURATION"
  | "SUBJECT_HOURS_EXCEEDED"
  | "SUBJECT_HOURS_INCOMPLETE";

export interface Section {
  id: Id;
  name: string;
  strength: number;
}

export interface Subject {
  id: Id;
  code: string;
  name: string;
  type: SubjectType;
  weeklyHours: number;
  durationPeriods: number;
  permittedRoomTypes?: RoomType[];
}

export interface Room {
  id: Id;
  name: string;
  type: RoomType;
  capacity: number;
}

export interface AvailabilityRule {
  resourceId: Id;
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  status: AvailabilityStatus;
}

/** One session can serve several sections. Do not duplicate shared sessions per section. */
export interface TimetableSession {
  id: Id;
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  subjectId: Id;
  teacherId: Id;
  roomId: Id;
  sectionIds: Id[];
  durationPeriods: number;
  isLocked?: boolean;
  notes?: string;
}

export interface TimeRange {
  day: DayOfWeek;
  startTime: string;
  endTime: string;
}

export interface ValidationContext {
  workingDays: DayOfWeek[];
  sections: readonly Section[];
  subjects: readonly Subject[];
  rooms: readonly Room[];
  /** Faculty/subject mappings are scoped to the active academic year and semester. */
  facultySubjectPairs: ReadonlySet<string>;
  teacherAvailability: readonly AvailabilityRule[];
  roomAvailability: readonly AvailabilityRule[];
  breaks: readonly TimeRange[];
  periodMinutes: number;
}

export interface ValidationIssue {
  code: ConflictCode;
  message: string;
  sessionId: Id;
  relatedSessionIds?: Id[];
  resourceId?: Id;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export const facultySubjectKey = (facultyId: Id, subjectId: Id) => `${facultyId}:${subjectId}`;

