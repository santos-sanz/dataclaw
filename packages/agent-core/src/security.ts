const SQL_MUTATION_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "truncate",
  "replace",
  "merge",
  "copy",
];

const PYTHON_MUTATION_PATTERNS = [
  /\bopen\(.+?,\s*["']w/,
  /\bopen\(.+?,\s*["']a/,
  /\bos\.remove\(/,
  /\bos\.rename\(/,
  /\bos\.system\(/,
  /\bsubprocess\./,
  /\brequests\./,
];

export function isMutatingSql(sql: string): boolean {
  const normalized = sql.toLowerCase().replace(/\s+/g, " ").trim();
  return SQL_MUTATION_KEYWORDS.some((keyword) => normalized.startsWith(keyword) || normalized.includes(` ${keyword} `));
}

export function isMutatingPython(code: string): boolean {
  return PYTHON_MUTATION_PATTERNS.some((pattern) => pattern.test(code));
}
