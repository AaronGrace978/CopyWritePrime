export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return (
    name === "AbortError" ||
    name === "CanceledError" ||
    message.includes("aborted") ||
    message.includes("abort") ||
    message.includes("canceled") ||
    message.includes("cancelled") ||
    message.includes("request canceled")
  );
}
