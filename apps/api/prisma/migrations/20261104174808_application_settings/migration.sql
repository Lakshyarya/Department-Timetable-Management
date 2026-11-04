-- CreateTable
CREATE TABLE "ApplicationSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationSetting_pkey" PRIMARY KEY ("key")
);
