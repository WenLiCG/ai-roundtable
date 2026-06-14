import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

type LogLevel = "info" | "warn" | "error";

export async function writeAppLog(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...data,
  });

  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "app.log"), `${line}\n`, "utf8");
  } catch (error) {
    console.error("Unable to write app log", error);
  }
}

