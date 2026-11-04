# Department of Computer Applications Timetable Management System

This repository is the foundation for the PRD-driven timetable platform. It is deliberately organised around one shared domain model and one server-side conflict validator, so manual editing, imports, AI candidates, and the solver all obey the same rules.

## Structure

- `apps/web` — React/Vite administrator interface (next milestone).
- `apps/api` — Express API and Prisma persistence layer.
- `apps/scheduler` — placeholder for the asynchronous CP-SAT scheduling worker.
- `packages/domain` — scheduling entities, constraints, and public contracts.
- `packages/validator` — deterministic timetable validation with tests.

## Start locally

1. Install Node.js 22+, pnpm 10+, and Docker Desktop.
2. Copy `.env.example` to `.env`. Change the database password in both `.env` and `docker-compose.yml` before any non-local deployment.
3. Run `docker compose up -d database`.
4. Run `pnpm install`, `pnpm db:generate`, then `pnpm db:migrate --name initial`.
5. In one terminal run `pnpm --filter @dca/api dev`; in another run `pnpm --filter @dca/web dev`.
6. Open `http://localhost:5173`. The API health endpoint is `http://localhost:4000/health`.

To enable OpenAI generation, add `OPENAI_API_KEY` to `.env` and restart the API. Without it, the deterministic generator remains available.

## Implemented workflows

- Academic configuration: years, semesters, programs, sections, subjects, faculty, rooms, class coordinators, time slots, and availability.
- Faculty-to-subject mappings, including CSV bulk import.
- Manual timetable session validation and persistence.
- Deterministic candidate generation that always runs through the same validator as manual edits.
- Validation reports, JSON project backup, and restore.

## API highlights

- `POST /api/import/faculty-subjects?semesterId=<id>` accepts CSV columns `facultyName,shortName,email,subjectCode`.
- `POST /api/timetable/validate` validates a candidate without saving it.
- `POST /api/timetable/sessions` persists a candidate only if validation passes.
- `POST /api/timetable/generate` returns a deterministic candidate schedule.
- `GET /api/reports/validation?semesterId=<id>` returns current hard errors and weekly-hour status.
- `GET /api/backup` and `POST /api/restore` provide project round-tripping. Restore replaces the current project data, so retain a backup before invoking it.
