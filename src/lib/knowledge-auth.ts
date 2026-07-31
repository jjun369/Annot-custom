/**
 * Knowledge processing is OAuth-only by product requirement. Keep this exact:
 * generic Codex authentication also includes API-key sessions.
 */
export function isKnowledgeChatGptOAuth(status: { authenticated: boolean; authMethod?: string } | null | undefined): boolean {
  return status?.authenticated === true && status.authMethod === 'ChatGPT';
}
