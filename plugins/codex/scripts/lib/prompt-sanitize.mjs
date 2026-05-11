const RENDER_UNSAFE_RANGES = [
  [0x0000, 0x001f],     // C0 controls (NUL through US, incl. tab/newline)
  [0x007f, 0x007f],     // DEL
  [0x0080, 0x009f],     // C1 controls
  [0x00ad, 0x00ad],     // SOFT HYPHEN (default-ignorable)
  [0x061c, 0x061c],     // ARABIC LETTER MARK
  [0x180e, 0x180e],     // MONGOLIAN VOWEL SEPARATOR (default-ignorable)
  [0x200b, 0x200d],     // ZWS / ZWNJ / ZWJ
  [0x200e, 0x200f],     // LRM / RLM
  [0x202a, 0x202e],     // bidi overrides (LRE/RLE/PDF/LRO/RLO)
  [0x2060, 0x2064],     // WORD JOINER + invisible operators
  [0x2066, 0x2069],     // bidi isolates (LRI/RLI/FSI/PDI)
  [0xd800, 0xdfff],     // lone surrogates (when iterating by code point)
  [0xfe00, 0xfe0f],     // BMP variation selectors
  [0xfeff, 0xfeff],     // BOM (ZWNBSP)
  [0xfff0, 0xffff],     // BMP specials (incl. replacement char, non-characters)
  [0x1bca0, 0x1bca3],   // SHORTHAND FORMAT CONTROLS (default-ignorable)
  [0xe0000, 0xe007f],   // tag characters (supplementary)
  [0xe0100, 0xe01ef]    // supplementary variation selectors
];

const PER_FILENAME_MAX_CHARS = 512;
const ELLIPSIS = "…";

export function escapeRenderUnsafeChars(s) {
  if (typeof s !== "string") return "";
  let out = "";
  let i = 0;
  while (i < s.length) {
    const code = s.codePointAt(i);
    const charLength = code > 0xffff ? 2 : 1;
    let unsafe = false;
    for (const [lo, hi] of RENDER_UNSAFE_RANGES) {
      if (code >= lo && code <= hi) {
        unsafe = true;
        break;
      }
    }
    if (unsafe) {
      if (code <= 0xffff) {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u{${code.toString(16)}}`;
      }
    } else if (code <= 0xffff) {
      out += s[i];
    } else {
      out += String.fromCodePoint(code);
    }
    i += charLength;
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
