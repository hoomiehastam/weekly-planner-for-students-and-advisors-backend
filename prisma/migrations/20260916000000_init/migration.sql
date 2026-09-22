-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'ADVISOR', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'DESCRIPTIVE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "plansLastViewedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "phone" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorStudentLink" (
    "id" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weeklyGoalMinutes" INTEGER,

    CONSTRAINT "AdvisorStudentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "advisorId" TEXT,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "studentId" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanDay" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,

    CONSTRAINT "PlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "actualMinutes" INTEGER,
    "testsTaken" INTEGER,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItemTag" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "PlanItemTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItemLog" (
    "id" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "tagId" TEXT,
    "minutes" INTEGER NOT NULL,
    "testsTaken" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanItemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "studentId" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "visibleToStudent" BOOLEAN NOT NULL DEFAULT false,
    "visibleFrom" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT,
    "options" TEXT,
    "correctOption" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 1,
    "imageUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSubmission" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "totalScore" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "feedback" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "ExamSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOption" INTEGER,
    "textAnswer" TEXT,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AdvisorStudentLink_advisorId_idx" ON "AdvisorStudentLink"("advisorId");

-- CreateIndex
CREATE INDEX "AdvisorStudentLink_studentId_idx" ON "AdvisorStudentLink"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AdvisorStudentLink_advisorId_studentId_key" ON "AdvisorStudentLink"("advisorId", "studentId");

-- CreateIndex
CREATE INDEX "Tag_advisorId_idx" ON "Tag"("advisorId");

-- CreateIndex
CREATE INDEX "StudyPlan_studentId_idx" ON "StudyPlan"("studentId");

-- CreateIndex
CREATE INDEX "StudyPlan_advisorId_idx" ON "StudyPlan"("advisorId");

-- CreateIndex
CREATE INDEX "PlanDay_planId_idx" ON "PlanDay"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanDay_planId_dayOfWeek_key" ON "PlanDay"("planId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "PlanItem_dayId_idx" ON "PlanItem"("dayId");

-- CreateIndex
CREATE INDEX "PlanItemTag_itemId_idx" ON "PlanItemTag"("itemId");

-- CreateIndex
CREATE INDEX "PlanItemTag_tagId_idx" ON "PlanItemTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanItemTag_itemId_tagId_key" ON "PlanItemTag"("itemId", "tagId");

-- CreateIndex
CREATE INDEX "PlanItemLog_planItemId_idx" ON "PlanItemLog"("planItemId");

-- CreateIndex
CREATE INDEX "PlanItemLog_tagId_idx" ON "PlanItemLog"("tagId");

-- CreateIndex
CREATE INDEX "Reminder_studentId_idx" ON "Reminder"("studentId");

-- CreateIndex
CREATE INDEX "Reminder_advisorId_idx" ON "Reminder"("advisorId");

-- CreateIndex
CREATE INDEX "Exam_studentId_idx" ON "Exam"("studentId");

-- CreateIndex
CREATE INDEX "Exam_advisorId_idx" ON "Exam"("advisorId");

-- CreateIndex
CREATE INDEX "Exam_scheduledAt_idx" ON "Exam"("scheduledAt");

-- CreateIndex
CREATE INDEX "ExamQuestion_examId_idx" ON "ExamQuestion"("examId");

-- CreateIndex
CREATE INDEX "ExamSubmission_examId_idx" ON "ExamSubmission"("examId");

-- CreateIndex
CREATE INDEX "ExamSubmission_studentId_idx" ON "ExamSubmission"("studentId");

-- CreateIndex
CREATE INDEX "ExamAnswer_submissionId_idx" ON "ExamAnswer"("submissionId");

-- CreateIndex
CREATE INDEX "ExamAnswer_questionId_idx" ON "ExamAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAnswer_submissionId_questionId_key" ON "ExamAnswer"("submissionId", "questionId");

-- AddForeignKey
ALTER TABLE "AdvisorStudentLink" ADD CONSTRAINT "AdvisorStudentLink_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisorStudentLink" ADD CONSTRAINT "AdvisorStudentLink_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanDay" ADD CONSTRAINT "PlanDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "PlanDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItemTag" ADD CONSTRAINT "PlanItemTag_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItemTag" ADD CONSTRAINT "PlanItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItemLog" ADD CONSTRAINT "PlanItemLog_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItemLog" ADD CONSTRAINT "PlanItemLog_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSubmission" ADD CONSTRAINT "ExamSubmission_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSubmission" ADD CONSTRAINT "ExamSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExamSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ExamQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

