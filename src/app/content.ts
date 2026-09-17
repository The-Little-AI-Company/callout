/** Content files bundled into the app. Edit the YAML, not this file. */
import questionsYaml from "@content/questions.yaml?raw";
import linesYaml from "@content/lines.yaml?raw";
import promptsYaml from "@content/helper-prompts.yaml?raw";
import { parseQuestionContent, parseLineBank, pickLine as pick } from "@engine/content";
import { parseHelperPrompts } from "@engine/helper/tasks";

export const questions = parseQuestionContent(questionsYaml);
export const lines = parseLineBank(linesYaml);
export const prompts = parseHelperPrompts(promptsYaml);

export const line = (surface: string): string => pick(lines, surface);
