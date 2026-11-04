-- CreateTable
CREATE TABLE "SectionSubject" (
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "SectionSubject_pkey" PRIMARY KEY ("sectionId","subjectId")
);

-- AddForeignKey
ALTER TABLE "SectionSubject" ADD CONSTRAINT "SectionSubject_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSubject" ADD CONSTRAINT "SectionSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
