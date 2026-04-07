/**
 * Strip ANSI escape sequences from a string.
 *
 * Terminals (and shells like zsh/bash) may emit control sequences such as
 * bracketed-paste-mode markers (`\e[?2004h`) into subprocess stdout.  When
 * the JSONL protocol reader encounters these bytes it fails to parse the
 * line as JSON.  Stripping them before `JSON.parse()` makes the protocol
 * resilient to noisy terminal environments.
 *
 * Covers:
 *  - CSI sequences   \x1b[ … <letter>        (e.g. \x1b[?2004h, \x1b[0m)
 *  - OSC sequences   \x1b] … <BEL|ST>        (e.g. window-title sets)
 *
 * @param {string} text
 * @returns {string}
 */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}
