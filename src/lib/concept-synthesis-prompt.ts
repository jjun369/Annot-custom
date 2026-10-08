export function buildConceptSynthesisPrompt(question: string): string {
  return [
    'Create a careful concept-synthesis proposal from only the explicitly selected PageDock records below.',
    'Do not present a synthesis as verified truth. Separate: (1) shared core concept, (2) what the cited literature says, (3) user observations/hypotheses, (4) AI inferences, (5) contradictions/version differences, and (6) open questions or checks.',
    'Attach the exact supplied record IDs to each material claim. Do not invent citations or imply verification. Preserve meaningful disagreement instead of resolving it by guess.',
    'A record labelled "Studio 초안" is unverified personal or AI-assisted working material, not literature evidence or a verified fact. Its authorship may be unknown or mixed: do not infer that it was AI-generated. Treat it only as a prior interpretation to question, and ground factual claims in separately selected original-source records.',
    'End with a short "학습 점검" section: one retrieval-practice question answerable from the selected records, a brief answer-check rubric citing the relevant record IDs, and one concrete next-reading or verification action tied to a named source/claim. If the selected records cannot support a fair question or action, say what evidence is missing rather than inventing it.',
    `User topic/question: ${question.trim().slice(0, 2_000)}`,
    '\nReturn a readable Markdown draft, with a short title first and a Sources section listing only record IDs actually used.',
  ].join('\n\n');
}
