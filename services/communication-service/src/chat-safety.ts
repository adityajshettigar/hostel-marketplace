// ============================================================================
// Chat Obfuscation Defense (SRS 5.7.2) — pure, unit-testable scanner.
//
// Pipeline: normalize -> scan -> verdict. No I/O, no state: every call is
// deterministic so the unit tests fully cover the security-critical logic.
//
//   1. lowercase; strip spaces, dashes and dots BETWEEN word characters
//      ("9 8-7.6" -> "9876", "nine eight" -> "nineeight")
//   2. spelled-out digits -> digits ("nine" -> "9"; "double"/"triple"
//      prefixes repeat the digit: "double four" -> "44")
//   3. regex-match on the normalized text:
//        - UPI VPAs (username@bankhandle)
//        - 10-digit Indian phone numbers (optionally +91/91/0-prefixed)
//        - off-platform request phrases (matched in normalized form, so
//          "p a y t m" and "phone pe" are caught)
//   4. return { verdict, normalized_text }
//
// Design notes:
// - Phone digits use lookarounds (?<![0-9]) / (?![0-9]) instead of \b so
//   numbers GLUED to letters ("callme9876543210") are still caught — \b
//   between a letter and a digit does not exist.
// - Off-platform phrases are matched as substrings of the glued text for the
//   same reason ("paytmpekaro" still contains "paytm"). The one risky stem,
//   "insta", is guarded so "instant" never matches.
// - VPAs whose handle ends in a generic email TLD (com/net/org/edu/gov) are
//   treated as email addresses, not UPI ids ("adi@gmail.com" -> SAFE).
// ============================================================================

export type SafetyVerdict = 'SAFE' | 'CONTACT_INFO' | 'UPI_INFO' | 'OFF_PLATFORM_REQUEST';

export type ScanResult = {
  verdict: SafetyVerdict;
  normalized_text: string;
};

// Separator characters (space/dash/dot) are removed only when sandwiched
// between word characters, so sentence structure at the edges survives.
const SEPARATORS = /(?<=[a-z0-9])[\s\-.]+(?=[a-z0-9])/g;

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

// Repetition prefixes — optional per SRS 5.7.2 ("double four" -> "44").
const MULTIPLIERS: Record<string, number> = {
  double: 2,
  triple: 3,
};

// 10-digit Indian mobile: starts 6-9, optionally after +91 / 91 / 0. The
// lookarounds reject matches inside longer digit runs and re-arm on letters
// glued to the number (see design notes).
const INDIAN_PHONE = /(?<![0-9])(?:\+?91|0)?[6-9]\d{9}(?![0-9])/g;

// UPI VPA: username@bankhandle. Boundaries are deliberately loose (substring
// match) so glued text cannot hide an @handle. Username must be >= 3 chars so
// casual "me @ campus" text is not misread as a VPA.
const UPI_VPA = /[a-z0-9._-]{3,}@[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*/g;

// Handles that are (or start with) a common webmail provider, or whose final
// dot-label starts with a generic email TLD, are email addresses, not UPI.
// PREFIX matching is deliberate: normalization glues continuations
// ("gmail.com instead" -> "gmailcominstead") so exact TLD equality fails.
const MAIL_PROVIDER = /^(?:gmail|hotmail|yahoo|outlook|rediff|icloud|live)/;
const EMAIL_TLD = /^(?:com|net|org|edu|gov)/;

function isEmailHandle(handle: string): boolean {
  if (MAIL_PROVIDER.test(handle)) return true;
  const lastLabel = handle.split('.').pop() ?? '';
  return EMAIL_TLD.test(lastLabel);
}

// Off-platform request language, matched against the NORMALIZED text.
const OFF_PLATFORM =
  /paytm|gpay|googlepay|phonepe|whatsapp|telegram|instagram|insta(?![a-z])|wame|dmme|directpay/;

function convertDigitWords(text: string): string {
  // Spelled-out digits (with repetition prefixes), left-to-right.
  // ("ninenineeight..." -> "998..."; "double four" -> "44")
  return text.replace(
    /(double|triple)?(zero|one|two|three|four|five|six|seven|eight|nine)/g,
    (_m, mult?: string, word?: string) => {
      const digit = word ? DIGIT_WORDS[word] : '';
      if (!digit) return _m;
      return mult && MULTIPLIERS[mult] ? digit.repeat(MULTIPLIERS[mult]) : digit;
    },
  );
}

function normalize(input: string): string {
  let text = String(input ?? '').toLowerCase();

  // 0. remove complete email addresses BEFORE separator stripping: they carry
  //    dots/underscores that normalization would glue away (turning
  //    "students.example.edu" into an unrecognizable blob) and must not be
  //    scanned as UPI VPAs. Contiguous form only (user@host.tld).
  text = text.replace(/[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/g, ' ');

  // 1. strip separator characters between word characters.
  text = text.replace(SEPARATORS, '');

  // 1b. glue spaces around '@' ("a d i @ y b l" -> "adi@ybl"); without this,
  // spaced-out VPAs evade detection entirely.
  text = text.replace(/\s*@\s*/g, '@');

  return text;
}

function findUpiVpa(text: string): string | null {
  UPI_VPA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UPI_VPA.exec(text)) !== null) {
    const handle = m[0].split('@')[1] ?? '';
    if (!isEmailHandle(handle)) return m[0];
  }
  return null;
}

// Public entry point (SRS 5.7.2): normalize + scan. The normalized text is
// returned so it can be persisted alongside the message for audit.
//
// Ordering matters: off-platform phrases are scanned on the LETTER-INTACT
// normalized form, BEFORE digit-word conversion — "phonepe" contains the
// substring "one", and blind digit conversion would corrupt it to "ph1pe".
// Then VPA beats bare phone (a VPA is the more specific finding).
export function normalizeAndScan(text: string): ScanResult {
  const pre = normalize(text);

  if (OFF_PLATFORM.test(pre)) {
    return { verdict: 'OFF_PLATFORM_REQUEST', normalized_text: convertDigitWords(pre) };
  }

  const normalized = convertDigitWords(pre);
  if (findUpiVpa(normalized)) return { verdict: 'UPI_INFO', normalized_text: normalized };
  INDIAN_PHONE.lastIndex = 0;
  if (INDIAN_PHONE.test(normalized)) {
    return { verdict: 'CONTACT_INFO', normalized_text: normalized };
  }
  return { verdict: 'SAFE', normalized_text: normalized };
}
