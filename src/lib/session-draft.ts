/** Leitura segura de rascunhos locais da aba atual do navegador. */
export function readSessionDraft<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Grava rascunhos apenas nesta aba; não usa banco nem armazenamento permanente. */
export function writeSessionDraft(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // O fluxo continua utilizável se o navegador bloquear armazenamento.
  }
}

/** Remove o rascunho quando o usuário conclui ou fecha o formulário. */
export function clearSessionDraft(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Sem armazenamento local, não há rascunho a remover.
  }
}
