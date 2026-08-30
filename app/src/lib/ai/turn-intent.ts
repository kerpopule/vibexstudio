/**
 * Decide whether a builder turn is expected to mutate project files.
 *
 * VibeX is an action-first coding surface, not a general chatbot. Follow-up
 * requests are often shorthand ("bigger", "use blue instead", "move that up")
 * and may omit an obvious coding verb. We therefore default established
 * projects to implementation unless the message is clearly conversational or
 * an information-only question.
 */
const ACTION_LANGUAGE =
  /\b(build|make|create|code|add|change|fix|update|edit|implement|wire|style|design|redesign|remove|replace|debug|ship|generate|move|resize|rename|swap|use|turn|put|align|center|hide|show|increase|decrease|brighten|darken|simplify|animate|connect|save)\b/i;

const CONVERSATION_ONLY =
  /^(hi|hey|hello|thanks|thank you|nice|cool|great|awesome|perfect|love it|looks good|okay|ok|yes|no|never mind|nevermind)[!. ]*$/i;

const INFORMATION_QUESTION =
  /^(what|why|when|where|who|which|how|should|is|are|do|does|did)\b/i;

const DIRECT_REQUEST_QUESTION = /^(can|could|would|will)\s+you\b/i;

export const NO_FILE_OUTPUT_MESSAGE =
  "That model still didn't send savable code blocks, so I didn't change your app. Try again, or switch models for this turn.";

export function expectsFileOutput(userText: string, hasExistingFiles: boolean): boolean {
  const text = userText.trim();
  if (!text || CONVERSATION_ONLY.test(text)) return false;

  // Polite imperative questions are implementation requests: "Can you make…?"
  if (DIRECT_REQUEST_QUESTION.test(text) && ACTION_LANGUAGE.test(text)) return true;

  // Explanatory/advice questions stay conversational even when they mention
  // coding verbs: "How do I change…?", "Why did you make…?"
  if (INFORMATION_QUESTION.test(text) || text.endsWith("?")) return false;

  if (ACTION_LANGUAGE.test(text)) return true;
  if (!hasExistingFiles) return true;

  // In an existing project, terse design feedback is an edit by default:
  // "more playful", "blue instead", "the header is too tall", etc.
  return true;
}

export function resolveAssistantText(
  parsedText: string,
  writtenFileCount: number,
  expectedFileOutput: boolean,
): string {
  if (expectedFileOutput && writtenFileCount === 0) return NO_FILE_OUTPUT_MESSAGE;
  if (parsedText) return parsedText;
  return writtenFileCount ? "Done! Check the preview." : "…";
}
