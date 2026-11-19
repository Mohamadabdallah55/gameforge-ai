import type {
  Asset,
  AssistantActionLog,
  AssistantMessage,
  AuditReport,
  Evidence,
  Job,
  Level,
  Plan,
  Profile,
  Question,
} from "../shared/contracts";

export type TabKey =
  | "production"
  | "library"
  | "media"
  | "search"
  | "audit"
  | "profiles";

export interface HealthStatus {
  ok: boolean;
  geminiConfigured: boolean;
  models?: {
    text: string;
    embed: string;
    image: string;
  };
  sqlite?: {
    integrity: boolean;
    sizeBytes: number;
    embedModel: string | null;
    counts: {
      profiles: number;
      questions: number;
      assets: number;
      jobs: number;
    };
  };
}

export interface SearchImageHit {
  title: string;
  url: string;
  fallbackUrl?: string;
  origin: string;
  credit: string;
  license: string;
  provider?: "wikimedia" | "openverse";
}

export interface ExportPreview {
  profileName: string;
  totalQuestions: number;
  illustratedCount: number;
  usedAssetsCount: number;
  missingAssets: number;
  headers: string[];
  sampleRows: Record<string, string>[];
}

export interface CopilotTurnResponse {
  message: AssistantMessage;
  actions: AssistantActionLog[];
  hints: {
    switchTab?: string;
    selectProfileId?: string;
    selectAssetId?: string;
    downloadUrl?: string;
    refreshAll: boolean;
  };
}

export const LEVEL_LABELS: Record<Level, string> = {
  easy: "سهل",
  medium: "متوسط",
  hard: "صعب",
};

export const JOB_STATUS_LABELS: Record<Job["status"], string> = {
  queued: "في الانتظار",
  running: "قيد الإنتاج",
  paused: "متوقفة مؤقتًا",
  failed: "توقفت لخطأ",
  complete: "مكتملة",
};

export const JOB_STAGE_LABELS: Record<string, string> = {
  queued: "جاهزة للبدء",
  researching: "جمع الأدلة والمصادر",
  drafting: "صياغة الأسئلة",
  verifying: "تدقيق الدليل والتشابه",
  media: "جلب وتجهيز الصور",
  saving: "حفظ في SQLite",
  paused: "متوقفة مؤقتًا",
  failed: "متوقفة",
  complete: "منتهية",
};

export const AUDIT_LABELS: Record<
  NonNullable<Question["auditStatus"]>,
  string
> = {
  verified: "مدقق",
  flagged: "بحاجة لمراجعة",
  pending: "غير مدقق",
};

export type {
  Asset,
  AssistantMessage,
  AuditReport,
  Evidence,
  Job,
  Level,
  Plan,
  Profile,
  Question,
};
