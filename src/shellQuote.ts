/**
 * Quote a value for safe display as a single POSIX shell argument.
 *
 * Clean tokens are returned unquoted; anything else is wrapped in single quotes
 * with embedded single quotes escaped. Single quoting is used deliberately:
 * unlike double quotes, it stops the shell from expanding `$(...)`, backticks,
 * and `$VAR` if a previewed command is copied and run. Values here can come from
 * untrusted registry metadata (server names) or user search text.
 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
