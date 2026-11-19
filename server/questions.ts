import { readFileSync } from "node:fs";
import path from "node:path";

export interface Answer {
  label: string;
  points: number;
  views: number;
  excess: number;
  aliases: string[];
  articles: string[];
}
export interface Question {
  id: string;
  prompt: string;
  short: string;
  answers: Answer[];
}
interface QuestionFile {
  generatedAt: string;
  method: { source: string; window: string; surveyAlpha: number; note: string };
  questions: Question[];
}

const file = path.resolve(import.meta.dirname, "..", "data", "questions.json");
export const QUESTION_DATA: QuestionFile = JSON.parse(readFileSync(file, "utf8"));
export const QUESTIONS = QUESTION_DATA.questions.filter((q) => q.answers.length >= 8);
export const DATA_NOTE = `Survey points from ${QUESTION_DATA.method.source} · ${QUESTION_DATA.method.window}`;

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
