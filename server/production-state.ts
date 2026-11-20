import type { Job } from "../shared/contracts";
import type { Store } from "./store";

export class ProductionUnavailable extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

export class JobInterrupted extends Error {
  constructor(readonly state: "paused" | "cancelled") {
    super(
      state === "paused"
        ? "أوقف المستخدم المهمة مؤقتًا"
        : "ألغى المستخدم المهمة",
    );
  }
}

export function checkJobControl(db: Store, job: Job) {
  const current = db.job(job.id);
  if (current?.status === "paused" || current?.status === "cancelled")
    throw new JobInterrupted(current.status);
}
