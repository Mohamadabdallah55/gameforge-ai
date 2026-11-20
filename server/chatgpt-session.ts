import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  lstatSync,
  constants,
  openSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const tokenEndpoint = issuer + "/api/accounts/oauth/token";
const permission = "chatgpt.tokens.use.direct";
const scopes =
  "openid profile email offline_access resource.invoke " + permission;
const jwks = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"));
const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
});
const tokens = tokenResponse.extend({
  expiresAt: z.number(),
  scope: z.string(),
});
const connection = z.object({
  client: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().optional(),
  model: z.string().optional(),
  tokens: tokens.optional(),
});
type Account = z.infer<typeof connection>;
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  uri: string;
  until: number;
  prior?: Account;
};
export class ChatGPTError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
  get pause() {
    return (
      [
        "chatgpt_sign_in_required",
        "chatgpt_plan_not_authorized",
        "chatgpt_plan_disabled",
        "chatgpt_account_changed",
        "subscription_sharing_usage_limit_exceeded",
        "subscription_sharing_usage_unavailable",
        "subscription_sharing_invalid_user",
        "subscription_sharing_user_unavailable",
        "chatpass_v2_scope_not_authorized",
        "chatpass_v2_invalid_authorization_context",
      ].includes(this.code) || this.status === 429
    );
  }
}
function stateEqual(a: string, b: string) {
  return (
    /^[a-z0-9_-]+$/i.test(a) &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
const random = () => randomBytes(32).toString("base64url");
const requestOptions = () => ({
  redirect: "error" as const,
  signal: AbortSignal.timeout(25000),
});
export class ChatGPTSession {
  private pending?: Pending;
  private renewing?: Promise<string>;
  private changing = false;
  private modelsCache?: {
    client: string;
    until: number;
    models: { id: string; name: string }[];
  };
  constructor(private dir: string) {}
  private ensure() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.dir);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw Error("مجلد مصادقة ChatGPT يحتاج صلاحية خاصة 0700");
  }
  private read(name: string) {
    this.ensure();
    try {
      const p = path.join(this.dir, name),
        stat = lstatSync(p);
      if (
        !stat.isFile() ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw Error("ملف مصادقة ChatGPT يحتاج صلاحية خاصة 0600");
      const fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        return JSON.parse(readFileSync(fd, "utf8"));
      } finally {
        closeSync(fd);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  private save(name: string, body: unknown) {
    this.ensure();
    const tmp = path.join(this.dir, randomUUID() + ".tmp");
    writeFileSync(tmp, JSON.stringify(body), { mode: 0o600, flag: "wx" });
    renameSync(tmp, path.join(this.dir, name));
  }
  private account() {
    const record = this.read("connection.json");
    return record ? connection.parse(record) : undefined;
  }
  private host() {
    const value = this.read("host.json");
    if (value)
      return z
        .string()
        .regex(/^urn:uuid:[\da-f-]{36}$/i)
        .parse(value);
    const id = "urn:uuid:" + randomUUID();
    this.save("host.json", id);
    return id;
  }
  status() {
    const a = this.account(),
      t = a?.tokens;
    return {
      signedIn: !!t,
      authorized: !!t?.scope.split(/\s+/).includes(permission),
      model: a?.model,
      email: t ? a?.email : undefined,
    };
  }
  bind() {
    const a = this.account();
    if (!a?.tokens)
      throw new ChatGPTError(
        "سجّل الدخول عبر Continue with ChatGPT أولًا.",
        "chatgpt_sign_in_required",
        401,
      );
    if (!a.tokens.scope.split(/\s+/).includes(permission))
      throw new ChatGPTError(
        "حساب ChatGPT لا يمنح استخدام حصة الخطة.",
        "chatgpt_plan_not_authorized",
        403,
      );
    if (!a.model)
      throw new ChatGPTError(
        "اختر نموذج ChatGPT من صفحة AI Engines.",
        "chatgpt_sign_in_required",
        409,
      );
    return { account: this.identity(a), model: a.model };
  }
  private identity(a: Account) {
    return createHash("sha256")
      .update(a.client + "\0" + a.subject)
      .digest("hex");
  }
  start(port: number, add = false) {
    if (this.changing) throw Error("انتظر اكتمال المصادقة الحالية");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error("منفذ OAuth غير صالح");
    const prior = add ? undefined : this.account();
    const pending = {
      state: random(),
      nonce: random(),
      verifier: random(),
      uri: "http://127.0.0.1:" + port + "/api/chatgpt/callback",
      until: Date.now() + 10 * 60e3,
      prior,
    };
    this.pending = pending;
    const url = new URL(issuer + "/api/accounts/authorize");
    url.search = new URLSearchParams({
      client_id: prior?.client || "dynamic_agent_client",
      ext_agent_host_id: this.host(),
      resource,
      scope: scopes,
      response_type: "code",
      redirect_uri: pending.uri,
      state: pending.state,
      nonce: pending.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256")
        .update(pending.verifier)
        .digest("base64url"),
      ...(prior ? {} : { agent_name_hint: "GameForge AI" }),
    }).toString();
    return url.href;
  }
  private async exchange(params: Record<string, string>) {
    const r = await fetch(tokenEndpoint, {
      ...requestOptions(),
      method: "POST",
      body: new URLSearchParams({ ...params, resource }),
    });
    const value: unknown = await r.json().catch(() => null);
    if (!r.ok) {
      const error = z
        .object({
          error: z.union([
            z.string(),
            z.object({ code: z.string().optional() }),
          ]),
        })
        .safeParse(value);
      const code = error.success
        ? typeof error.data.error === "string"
          ? error.data.error
          : error.data.error.code
        : undefined;
      throw new ChatGPTError(
        "تعذّر تجديد أو إكمال مصادقة ChatGPT.",
        code || "oauth_exchange_failed",
        r.status,
        r.headers.get("x-request-id") || undefined,
      );
    }
    return tokenResponse.parse(value);
  }
  async complete(q: URLSearchParams) {
    const p = this.pending,
      state = q.get("state");
    if (
      !p ||
      p.until < Date.now() ||
      !state ||
      !stateEqual(state, p.state) ||
      q.getAll("state").length !== 1
    )
      throw Error("جلسة الربط غير صالحة أو انتهت");
    this.pending = undefined;
    if (q.has("error")) throw Error("لم تكتمل موافقة ChatGPT");
    const callbackClient = q.get("client_id"),
      client = p.prior?.client || callbackClient,
      code = q.get("code");
    if (
      !client ||
      client === "dynamic_agent_client" ||
      !code ||
      q.getAll("code").length !== 1 ||
      q.getAll("client_id").length > 1 ||
      (p.prior && callbackClient && callbackClient !== p.prior.client)
    )
      throw Error("رد تسجيل ChatGPT غير مكتمل");
    this.changing = true;
    try {
      await this.renewing?.catch(() => {});
      const t = await this.exchange({
        grant_type: "authorization_code",
        client_id: client,
        code,
        code_verifier: p.verifier,
        redirect_uri: p.uri,
      });
      if (!t.id_token) throw Error("لم يرجع ChatGPT إثبات الهوية");
      const { payload } = await jwtVerify(t.id_token, jwks, {
        issuer,
        audience: client,
        requiredClaims: ["exp", "sub", "nonce"],
      });
      if (
        !payload.sub ||
        payload.nonce !== p.nonce ||
        (p.prior && p.prior.subject !== payload.sub)
      )
        throw Error("هوية ChatGPT لا تطابق التسجيل");
      this.save("connection.json", {
        client,
        subject: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
        model: p.prior?.model,
        tokens: {
          ...t,
          scope: t.scope || "",
          expiresAt: Date.now() + 1000 * t.expires_in,
        },
      });
      this.modelsCache = undefined;
    } finally {
      this.changing = false;
    }
  }
  async authorization(expected?: string, force = false) {
    const a = this.account();
    if (this.changing || !a?.tokens)
      throw new ChatGPTError(
        "يلزم تسجيل الدخول إلى ChatGPT.",
        "chatgpt_sign_in_required",
        401,
      );
    if (expected && this.identity(a) !== expected)
      throw new ChatGPTError(
        "هذه المهمة مرتبطة بحساب ChatGPT الأصلي.",
        "chatgpt_account_changed",
        409,
      );
    if (!a.tokens.scope.split(/\s+/).includes(permission))
      throw new ChatGPTError(
        "استخدام حصة ChatGPT غير مفوّض.",
        "chatgpt_plan_not_authorized",
        403,
      );
    if (!force && Date.now() + 90e3 < a.tokens.expiresAt)
      return a.tokens.access_token;
    if (!this.renewing)
      this.renewing = this.refresh(a).finally(() => {
        this.renewing = undefined;
      });
    return this.renewing;
  }
  private async refresh(a: Account) {
    const old = a.tokens!;
    if (!old.refresh_token)
      throw new ChatGPTError(
        "انتهت جلسة ChatGPT. سجّل الدخول مجددًا.",
        "chatgpt_sign_in_required",
        401,
      );
    let next;
    try {
      next = await this.exchange({
        grant_type: "refresh_token",
        client_id: a.client,
        refresh_token: old.refresh_token,
      });
    } catch (e) {
      if (
        e instanceof ChatGPTError &&
        [
          "invalid_grant",
          "invalid_refresh_token",
          "token_expired",
          "refresh_token_expired",
          "refresh_token_invalidated",
          "refresh_token_reused",
        ].includes(e.code)
      ) {
        this.save("connection.json", { ...a, tokens: undefined });
        throw new ChatGPTError(
          "انتهت جلسة ChatGPT. سجّل الدخول مجددًا.",
          "chatgpt_sign_in_required",
          401,
        );
      }
      throw e;
    }
    const scope = next.scope ?? old.scope;
    this.save("connection.json", {
      ...a,
      tokens: {
        ...next,
        id_token: old.id_token,
        refresh_token: next.refresh_token || old.refresh_token,
        scope,
        expiresAt: Date.now() + next.expires_in * 1000,
      },
    });
    if (!scope.split(/\s+/).includes(permission))
      throw new ChatGPTError(
        "لم تعد حصة ChatGPT مفوّضة.",
        "chatgpt_plan_not_authorized",
        403,
      );
    return next.access_token;
  }
  async models() {
    const a = this.account();
    if (
      a &&
      this.modelsCache?.client === a.client &&
      this.modelsCache.until > Date.now()
    )
      return this.modelsCache.models;
    const access = await this.authorization();
    const r = await fetch(resource + "/models", {
      ...requestOptions(),
      headers: { authorization: "Bearer " + access },
    });
    if (!r.ok)
      throw new ChatGPTError(
        "تعذّر جلب نماذج حساب ChatGPT.",
        r.status === 401 ? "chatgpt_sign_in_required" : "chatgpt_models_failed",
        r.status,
      );
    const { models } = z
      .object({
        models: z.array(
          z.object({
            slug: z.string(),
            display_name: z.string(),
            visibility: z.string(),
          }),
        ),
      })
      .parse(await r.json());
    const list = models
      .filter((m) => m.visibility === "list")
      .map((m) => ({ id: m.slug, name: m.display_name }));
    this.modelsCache = {
      client: a!.client,
      until: Date.now() + 5 * 60e3,
      models: list,
    };
    return list;
  }
  async pick(model: string) {
    const a = this.account();
    if (!a?.tokens || !(await this.models()).some((m) => m.id === model))
      throw Error("هذا النموذج غير متاح للحساب");
    const current = this.account();
    if (!current?.tokens || this.identity(current) !== this.identity(a))
      throw Error("تغيّر حساب ChatGPT");
    this.save("connection.json", { ...current, model });
  }
  async signOut() {
    if (this.changing) throw Error("انتظر اكتمال المصادقة الحالية");
    this.changing = true;
    this.pending = undefined;
    try {
      await this.renewing?.catch(() => {});
      const a = this.account();
      if (!a) return { revoked: true };
      let revoked = !a.tokens?.refresh_token;
      if (a.tokens?.refresh_token) {
        try {
          const doc = await fetch(
            issuer + "/.well-known/openid-configuration",
            requestOptions(),
          );
          const url = new URL((await doc.json()).revocation_endpoint);
          if (url.origin !== issuer) throw Error("Unexpected revocation host");
          const r = await fetch(url, {
            ...requestOptions(),
            method: "POST",
            body: new URLSearchParams({
              token: a.tokens.refresh_token,
              token_type_hint: "refresh_token",
              client_id: a.client,
            }),
          });
          revoked = r.status === 200;
        } catch {}
      }
      this.save("connection.json", { ...a, tokens: undefined });
      this.modelsCache = undefined;
      return { revoked };
    } finally {
      this.changing = false;
    }
  }
}
