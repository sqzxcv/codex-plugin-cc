const RENDER_UNSAFE_RANGES = [
  [0x0000, 0x001f],
  [0x007f, 0x007f],
  [0x0080, 0x009f],
  [0x200b, 0x200d],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
];

const PER_FILENAME_MAX_CHARS = 512;
const ELLIPSIS = "…";

export function escapeRenderUnsafeChars(s) {
  if (typeof s !== "string") return "";
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    let escape = false;
    for (const [lo, hi] of RENDER_UNSAFE_RANGES) {
      if (code >= lo && code <= hi) {
        escape = true;
        break;
      }
    }
    if (escape) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += s[i];
    }
  }
  return out;
}

function truncatePayload(s, maxChars) {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + ELLIPSIS;
}

function stringifyEscapedPayload(s) {
  return JSON.stringify(s).replace(/\\\\u([0-9a-f]{4})/g, "\\u$1");
}

export function sanitizeFilenamesForPrompt(files) {
  if (!Array.isArray(files)) return "";
  return files
    .map((f) =>
      stringifyEscapedPayload(
        truncatePayload(escapeRenderUnsafeChars(String(f)), PER_FILENAME_MAX_CHARS)
      )
    )
    .join("\n");
}
