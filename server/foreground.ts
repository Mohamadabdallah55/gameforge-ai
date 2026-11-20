import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exclusive } from "./local";

const execute = promisify(execFile);
export const foregroundBinary = () =>
  process.env.GAMEFORGE_FOREGROUND_BIN ||
  path.resolve("../../work/engines/gameforge-foreground");

export async function removeForegroundBackground(bytes: Buffer) {
  if (process.platform !== "darwin" || !existsSync(foregroundBinary()))
    throw Error(
      "محرك إزالة الخلفية Apple Vision غير جاهز. شغّل المشغّل المحلي على macOS 14 أو أحدث مع أدوات سطر الأوامر.",
    );
  return exclusive("Apple Vision", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "forge-mask-"));
    try {
      const input = path.join(dir, "original.png");
      const output = path.join(dir, "foreground.png");
      await writeFile(input, bytes);
      try {
        await execute(foregroundBinary(), [input, output], { timeout: 25000 });
      } catch (error) {
        throw Error(
          "تعذّر فصل العنصر عن الخلفية: " +
            ((error as { stderr?: string }).stderr?.trim() ||
              "لم يكتمل تحليل الصورة"),
        );
      }
      return await readFile(output);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
