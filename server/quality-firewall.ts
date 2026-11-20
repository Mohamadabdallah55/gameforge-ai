import { reveals, exactQuote } from "./quality-gates";
import { normalize } from "./store";

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function normalizeDigits(text: string): string {
  return text.replace(ARABIC_DIGITS, (ch) => String(ch.charCodeAt(0) & 15));
}

const STOP_WORDS = new Set([
  "من",
  "في",
  "على",
  "الى",
  "إلى",
  "عن",
  "ما",
  "هو",
  "هي",
  "هم",
  "التي",
  "الذي",
  "الذين",
  "عام",
  "سنة",
  "اي",
  "أي",
  "كم",
  "متى",
  "أين",
  "اين",
  "لماذا",
  "كيف",
  "بعد",
  "قبل",
  "بين",
  "ضد",
  "مع",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "كان",
  "كانت",
  "تم",
  "التي",
  "بأي",
  "فيما",
]);

function contentTokens(text: string): string[] {
  return normalize(normalizeDigits(text))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Strips years, edition numbers, and proper names into a structural Arabic template signature
 * to catch batch repetition like "ما هو ملعب نهائي دوري أبطال أوروبا YYYY؟".
 */
export function questionStructureSignature(question: string): string {
  const clean = normalize(normalizeDigits(question))
    .replace(/\b(?:18|19|20)\d{2}\b/g, "{YEAR}")
    .replace(/\b\d+\b/g, "{NUM}")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = clean
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w));
  return tokens.slice(0, 10).join(" ");
}

export interface FirewallInput {
  question: string;
  answer: string;
  quote?: string;
  sourceText?: string;
  hasImage?: boolean;
  existingQuestions?: { question: string; answer: string }[];
}

export interface FirewallResult {
  passed: boolean;
  stage?: "firewall-leak" | "firewall-trivial" | "firewall-evidence" | "firewall-duplicate" | "firewall-clarity";
  reason?: string;
}

export function runQuestionFirewall(input: FirewallInput): FirewallResult {
  const q = input.question.trim();
  const a = input.answer.trim();

  if (q.length < 12) {
    return {
      passed: false,
      stage: "firewall-clarity",
      reason: "صياغة السؤال قصيرة جدًا ولا تكفي لتكوين سؤال مسابقة واضح.",
    };
  }

  if (!a || a.length < 1) {
    return {
      passed: false,
      stage: "firewall-clarity",
      reason: "السؤال يفتقد لإجابة محددة.",
    };
  }

  // 1. Strict answer leak (full phrase, Arabic/Western digits, or definite-article stem)
  if (reveals(q, a)) {
    return {
      passed: false,
      stage: "firewall-leak",
      reason: "السؤال يكشف إجابته مباشرة داخل الصياغة.",
    };
  }

  const normQ = normalize(normalizeDigits(q));
  const normA = normalize(normalizeDigits(a));
  const answerTokens = contentTokens(a);

  // Reject single-year self-answering or numeric answer present verbatim in question
  if (/^\d{3,4}$/.test(normA) && normQ.includes(normA)) {
    return {
      passed: false,
      stage: "firewall-leak",
      reason: "السنة أو الرقم المطلوب في الإجابة مذكور داخل نص السؤال.",
    };
  }

  // Reject multi-word answers where all meaningful answer words already appear inside question
  if (
    answerTokens.length >= 2 &&
    answerTokens.every((t) => t.length >= 3 && normQ.split(" ").includes(t))
  ) {
    return {
      passed: false,
      stage: "firewall-leak",
      reason: "كلمات الإجابة الأساسية متكررة بالكامل داخل نص السؤال.",
    };
  }

  // 2. Reject overly generic / non-interrogative / image-dependent prompts with no image
  if (
    !input.hasImage &&
    /(في الصورة|الظاهر في الصورة|من الرسم|من اللقطة|هذه الصورة)/.test(q)
  ) {
    return {
      passed: false,
      stage: "firewall-clarity",
      reason: "يشير السؤال إلى صورة أو لقطة غير مرفقة به.",
    };
  }

  const qTokens = contentTokens(q);
  if (qTokens.length < 3) {
    return {
      passed: false,
      stage: "firewall-trivial",
      reason: "السؤال شديد العمومية ولا يحتوي على سياق معرفي محدد.",
    };
  }

  // 3. Verify quote evidence if provided
  if (input.sourceText !== undefined && input.quote !== undefined) {
    if (!exactQuote(input.sourceText, input.quote)) {
      return {
        passed: false,
        stage: "firewall-evidence",
        reason: "الاقتباس الداعم غير مطابق نصيًا لمحتوى المصدر المسترجع.",
      };
    }
  }

  // 4. Reject exact/near-structural intellectual duplicates against existing questions
  if (input.existingQuestions?.length) {
    const sig = questionStructureSignature(q);
    for (const prev of input.existingQuestions) {
      if (normalize(normalizeDigits(prev.question)) === normQ) {
        return {
          passed: false,
          stage: "firewall-duplicate",
          reason: "السؤال مطابق حرفيًا لسؤال محفوظ مسبقًا.",
        };
      }
      // If same question skeleton AND year-only swap (e.g. "في اي مدينة اقيم نهائي ... {YEAR}")
      const prevSig = questionStructureSignature(prev.question);
      if (
        sig.includes("{YEAR}") &&
        sig === prevSig &&
        normalize(prev.answer) !== normA
      ) {
        return {
          passed: false,
          stage: "firewall-duplicate",
          reason: "تكرار فكري بنفس قالب السؤال مع تغيير السنة فقط.",
        };
      }
    }
  }

  return { passed: true };
}
