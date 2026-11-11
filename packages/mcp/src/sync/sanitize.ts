/*
 * Redacts what must never leave the machine: keys, tokens, passwords and credentials in URLs.
 * The server applies the same rules to report text (contract section 6), so keep the lists equal.
 */

const MARK = '[removido]';

const RULES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MARK],
  [/AKIA[0-9A-Z]{16}/g, MARK],
  [/sk_live_\w+/g, MARK],
  [/sk_test_\w+/g, MARK],
  [/rk_live_\w+/g, MARK],
  [/sk-ant-[\w-]+/g, MARK],
  [/sk-[A-Za-z0-9]{20,}/g, MARK],
  [/ghp_\w+/g, MARK],
  [/gho_\w+/g, MARK],
  [/ghs_\w+/g, MARK],
  [/github_pat_\w+/g, MARK],
  [/xox[abprs]-[\w-]+/g, MARK],
  [/pwt_\w+/g, MARK],
  [/pw_\w{16,}/g, MARK],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, MARK],
  [/(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g, `$1${MARK}@`],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"',;]{6,}/gi, `$1=${MARK}`],
  // Hex digests of 40+ characters are a subset of this class, so one rule covers both.
  [/([=:]\s*["']?)[A-Za-z0-9+/]{40,}={0,2}/g, `$1${MARK}`],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/** Redacts first, then cuts: a secret is never half-cut into something readable. */
export function sanitizeText(text: string, max: number): string {
  const clean = redact(text);
  return clean.length > max ? clean.slice(0, max) : clean;
}

const FORBIDDEN: RegExp[] = [
  /^\.env$/i,
  /^\.env\.(?!example$|sample$|template$)/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /\.pfx$/i,
  /\.p12$/i,
  /^credentials.*\.json$/i,
  /^secrets\./i,
];

/** Files that are never opened, not even to be ignored (contract 3.3). Matched by file name. */
export function isForbiddenPath(relPath: string): boolean {
  const name = relPath.split('/').pop() ?? relPath;
  return FORBIDDEN.some((pattern) => pattern.test(name));
}
