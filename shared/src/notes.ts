/**
 * D6 — every note string the product can inject lives here, so a later content
 * pass is a one-line change rather than a grep across the engine. Tests assert
 * *distinctness* between the two fallback notes rather than hard-coding a
 * literal, which decouples the build from the pending copy confirmation (Δ2).
 *
 * The attachment-failure note is an EXACT product guarantee carried verbatim
 * from `01-pm-brief.md` §6 item 8 and `03-ui-direction.md` §4. It is rendered
 * in full, never truncated or ellipsized.
 */

/** Exact, non-negotiable. Do not reword. */
export function attachmentFallbackNote(attachmentName: string): string {
  return `[Classroom Copier Note: Original attachment '${attachmentName}' could not be linked due to a permission error or deleted file.]`
}

/**
 * Architect-proposed (no exact string existed upstream) — Δ2 routes it to
 * whoever owns copy before ship. Deliberately a DIFFERENT string from the
 * attachment note: the two describe different events and F13's gate asserts
 * they differ.
 */
export function rateLimitExhaustionNote(attempts: number): string {
  return `[Classroom Copier Note: Google was rate-limiting requests and this post could not be copied in full after ${attempts} attempts. A draft shell was created so nothing was lost — re-attach any files and re-check the details before publishing.]`
}

/** F7 — rubric could not be copied because the mock licence tier blocks it. */
export function rubricDegradedNote(): string {
  return `[Classroom Copier Note: The rubric on this assignment could not be copied because the target course's Workspace licence does not include rubrics. Everything else transferred.]`
}

/** F5 — attachments beyond the 20-attachment cap, appended as description links. */
export function attachmentOverflowNote(overflowCount: number): string {
  return `${overflowCount} attachment${overflowCount === 1 ? '' : 's'} appended as links — 20 max per post.`
}

/** Scenario 3, "Skip Attachment and Note Draft" (D15 -> fallback_shell). */
export function attachmentSkippedByUserNote(attachmentName: string): string {
  return attachmentFallbackNote(attachmentName)
}

/** Header for the overflow links appended into a post's description. */
export const OVERFLOW_LINKS_HEADER = 'Additional attachments (beyond the 20-attachment limit):'

/**
 * P0-1 — the post EXISTS in the target course, but a follow-up step (clearing
 * the rate-limit pause, reading or writing the rubric, patching the
 * description) failed afterwards. Saying "nothing was written" here is a
 * factual falsehood that sends the teacher to re-create a post that is already
 * there — the exact duplicate the no-auto-resume decision exists to prevent.
 */
export function postCreatedFollowUpFailedNote(step: string): string {
  return `[Classroom Copier Note: This post WAS created in the target course, but a follow-up step (${step}) did not complete. Open the draft and check it before publishing.]`
}

/**
 * APPLY-A — a Drive attachment whose sharing setting could not be read. The
 * brief's binding requirement is "preserve each attachment's shareMode … never
 * default to VIEW", so an unreadable shareMode becomes a FINDING and the file
 * is left unlinked with this note, never quietly re-shared as VIEW.
 */
export function shareModeUnknownNote(attachmentName: string): string {
  return `[Classroom Copier Note: Original attachment '${attachmentName}' was not linked because its sharing setting could not be read. Re-attach it and set the sharing option you want — we will not guess one for you.]`
}
