/**
 * Strip lightweight markdown from AI-generated text so it renders cleanly
 * in UI components that don't support markdown formatting.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")   // bold
    .replace(/\*(.+?)\*/g, "$1")       // italic
    .replace(/__(.+?)__/g, "$1")       // underline-ish
    .replace(/_(.+?)_/g, "$1")         // italic alt
    .replace(/^---\s*$/gm, "\n\n")     // horizontal rules
    .replace(/\n{3,}/g, "\n\n");       // collapse extra blank lines
}
