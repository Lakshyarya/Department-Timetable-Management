import { z } from "zod";
import { loadValidationContext, prisma } from "./timetable.js";
import { validateTimetable } from "@dca/validator";

const SessionSchema = z.object({ day: z.enum(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"]), startTime: z.string(), endTime: z.string(), subjectId: z.string(), teacherId: z.string(), roomId: z.string(), sectionIds: z.array(z.string()).min(1), durationPeriods: z.number().int().positive() });
const CandidateSchema = z.object({ sessions: z.array(SessionSchema) });

export async function openAiCandidate(semesterId: string) {
  const key = process.env.OPENAI_API_KEY; if (!key) throw new Error("OPENAI_API_KEY is not configured on the server.");
  const [context, existing] = await Promise.all([loadValidationContext(semesterId), prisma.timetableSession.findMany({ where: { semesterId }, include: { sections: true } })]);
  const state = { sections: context.sections, subjects: context.subjects, rooms: context.rooms, facultySubjectPairs: [...context.facultySubjectPairs], existing: existing.map(s => ({ id: s.id, day: s.day, startTime: s.startTime, endTime: s.endTime, subjectId: s.subjectId, teacherId: s.teacherId, roomId: s.roomId, sectionIds: s.sections.map(x => x.sectionId), durationPeriods: s.durationPeriods })) };
  const schema = { type: "object", additionalProperties: false, required: ["sessions"], properties: { sessions: { type: "array", items: { type: "object", additionalProperties: false, required: ["day", "startTime", "endTime", "subjectId", "teacherId", "roomId", "sectionIds", "durationPeriods"], properties: { day: { type: "string", enum: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] }, startTime: { type: "string" }, endTime: { type: "string" }, subjectId: { type: "string" }, teacherId: { type: "string" }, roomId: { type: "string" }, sectionIds: { type: "array", items: { type: "string" } }, durationPeriods: { type: "integer" } } } } } };
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-5", store: false, instructions: "Return only a timetable candidate. Preserve IDs exactly. Respect all hard constraints. Do not invent IDs.", input: JSON.stringify(state), text: { format: { type: "json_schema", name: "timetable_candidate", strict: true, schema } } }) });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`); const body: any = await response.json(); const candidate = CandidateSchema.parse(JSON.parse(body.output_text));
  const sessions = candidate.sessions.map((s, index) => ({ ...s, id: `ai-${index}` })); return { status: "candidate", provider: "openai", sessions, validation: validateTimetable(context, sessions) };
}
