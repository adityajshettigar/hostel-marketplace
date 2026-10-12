import { describe, it, expect } from 'vitest';
import { normalizeAndScan } from '../src/chat-safety';

// ---------------------------------------------------------------------------
// Unit tests for the Chat Obfuscation Defense (SRS 5.7.2) — the
// security-critical pure function. No DB, no network: pure input -> verdict.
//
// NOTE: per SRS 5.7.2 step 1, separators BETWEEN word characters are stripped,
// so normalized_text has interior spaces removed ("call me on 98..." keeps its
// edge words but glues word-to-digit joins). Tests assert the glued forms.
// ---------------------------------------------------------------------------

describe('normalizeAndScan — phone numbers (CONTACT_INFO)', () => {
  it('1. flags a plain 10-digit Indian phone number', () => {
    expect(normalizeAndScan('call me on 9876543210')).toEqual({
      verdict: 'CONTACT_INFO',
      normalized_text: 'callmeon9876543210',
    });
  });

  it('2. flags a space-separated number ("9 8 7 6 5 4 3 2 1 0")', () => {
    expect(normalizeAndScan('my number is 9 8 7 6 5 4 3 2 1 0').verdict).toBe('CONTACT_INFO');
  });

  it('3. flags a dash-separated number ("987-654-3210")', () => {
    expect(normalizeAndScan('dial 987-654-3210 today').verdict).toBe('CONTACT_INFO');
  });

  it('4. flags a dot-separated number ("9.8.7.6.5.4.3.2.1.0")', () => {
    expect(normalizeAndScan('9.8.7.6.5.4.3.2.1.0').verdict).toBe('CONTACT_INFO');
  });

  it('5. flags +91-prefixed and 0-prefixed numbers', () => {
    expect(normalizeAndScan('+91 98765 43210').verdict).toBe('CONTACT_INFO');
    expect(normalizeAndScan('0 9876543210').verdict).toBe('CONTACT_INFO');
  });

  it('6. flags ten spelled-out digits in a row', () => {
    expect(normalizeAndScan('nine eight seven six five four three two one zero').verdict).toBe(
      'CONTACT_INFO',
    );
  });

  it('7. flags a number glued to words (no spaces: "callme9876543210")', () => {
    expect(normalizeAndScan('callme9876543210').verdict).toBe('CONTACT_INFO');
  });

  it('8. flags an obfuscated spelled-out + separator combo', () => {
    const r = normalizeAndScan('nine eight - seven six five - four three two one zero');
    expect(r.verdict).toBe('CONTACT_INFO');
    // Spelled-out words are converted before scanning, so the stored
    // normalized_text is the fully de-obfuscated digit run.
    expect(r.normalized_text).toBe('9876543210');
  });
});

describe('normalizeAndScan — UPI ids (UPI_INFO)', () => {
  it('9. flags a plain UPI VPA', () => {
    expect(normalizeAndScan('pay to adi.sharma@okhdfcbank')).toEqual({
      verdict: 'UPI_INFO',
      normalized_text: 'paytoadisharma@okhdfcbank',
    });
  });

  it('10. flags an obfuscated VPA with separators inside', () => {
    expect(normalizeAndScan('send it to a d i @ y b l . h a r e k r i s h n a').verdict).toBe('UPI_INFO');
  });

  it('11. flags a VPA glued into sentence text (name@ybl)', () => {
    expect(normalizeAndScan('pay at rahul12@ybl fast').verdict).toBe('UPI_INFO');
  });

  it('12. does NOT flag ordinary email addresses (gmail/edu TLDs)', () => {
    expect(normalizeAndScan('mail me at adi@gmail.com instead').verdict).toBe('SAFE');
    expect(normalizeAndScan('write to hostel.desk@students.example.edu').verdict).toBe('SAFE');
    expect(normalizeAndScan('adi@gmail.cominstead is still an email').verdict).toBe('SAFE');
  });
});

describe('normalizeAndScan — off-platform requests', () => {
  it('13. flags paytm/gpay/phonepe requests', () => {
    expect(normalizeAndScan('lets do this deal over paytm').verdict).toBe('OFF_PLATFORM_REQUEST');
    expect(normalizeAndScan('gpay kar de bhai').verdict).toBe('OFF_PLATFORM_REQUEST');
    expect(normalizeAndScan('phonepe transfer karo').verdict).toBe('OFF_PLATFORM_REQUEST');
  });

  it('14. flags obfuscated app names ("w h a t s a p p", "paytm pe karo")', () => {
    expect(normalizeAndScan('w h a t s a p p pe msg karo').verdict).toBe('OFF_PLATFORM_REQUEST');
    expect(normalizeAndScan('paytm pe karo').verdict).toBe('OFF_PLATFORM_REQUEST');
  });
});

describe('normalizeAndScan — false-positive-prone SAFE messages', () => {
  it('15. keeps "meet at 9" SAFE (single digit, context words)', () => {
    const r = normalizeAndScan('meet at 9');
    expect(r.verdict).toBe('SAFE');
    expect(r.normalized_text).toBe('meetat9');
  });

  it('16. keeps prices, times and room numbers SAFE', () => {
    expect(normalizeAndScan('price is 1500, room 42, block C at 10:30pm').verdict).toBe('SAFE');
    expect(normalizeAndScan('I have 3 books, condition good, sold at 5pm').verdict).toBe('SAFE');
  });

  it('16b. keeps long digit runs starting with 0-5 SAFE (not Indian mobiles)', () => {
    expect(normalizeAndScan('order id 1234567890 is processed').verdict).toBe('SAFE');
  });
});

describe('normalizeAndScan — obfuscated combos', () => {
  it('17. catches spelled-out digit runs incl. double/triple prefixes', () => {
    // Exactly 10 digits after conversion (an 11-digit run is NOT a valid
    // 10-digit Indian mobile and stays SAFE per the SRS regex spec).
    expect(normalizeAndScan('nine nine eight seven six five four three two one').verdict).toBe(
      'CONTACT_INFO',
    );
    expect(normalizeAndScan('double nine triple six double four one zero one').verdict).toBe(
      'CONTACT_INFO',
    );
  });

  it('18. precedence: a VPA is UPI_INFO even when a phone number is also present', () => {
    expect(normalizeAndScan('9876543210 or adi@ybl').verdict).toBe('UPI_INFO');
  });

  it('19. digits glued to letters across separators are still caught', () => {
    expect(normalizeAndScan('textme-9876543210-now').verdict).toBe('CONTACT_INFO');
  });
});
