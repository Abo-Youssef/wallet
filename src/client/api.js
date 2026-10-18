import { prepareWrite, finishWrite } from "../shared/writes.mjs";
export async function request(path, method = "GET", payload, actor = "", context = {}) {
  const preview = path === "/api/backup/preview" && method === "POST",
    writing = method !== "GET" && !preview,
    options = { method, headers: { "X-Requested-With": "XMLHttpRequest" }, cache:"no-store", credentials:"same-origin" };
  let prepared;
  if (method !== "GET") {
    if (writing) prepared = await prepareWrite(path, method, {...payload,
      database_generation:path === "/api/backup/restore" ? payload?.checkpoint?.generation ?? "" : context.databaseGeneration ?? ""}, actor);
    options.headers = {
      ...options.headers,
      "Content-Type": "application/json",
      "X-Wallet-Action": "1",
      ...(context.managerAssistantMode ? { "X-Wallet-Mode": "assistant" } : {}),
    };
    options.body = JSON.stringify(prepared?.body ?? payload);
  }
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), path.startsWith("/api/backup/") ? 60000 : 20000);
  options.signal = controller.signal;
  try {
    let response;
    try {
      response = await fetch(path, options);
    } catch {
      throw Object.assign(
        new Error(
          writing
            ? "لم يصل تأكيد الحفظ. أعد المحاولة بالبيانات نفسها لتأكيد النتيجة دون تكرار."
            : "تعذر الاتصال. تحقق من الإنترنت ثم أعد المحاولة.",
        ),
        { uncertain: writing },
      );
    }
    // Access may return an HTML challenge instead of the Worker's JSON response.
    // Keep an explicit HTTP auth failure distinguishable from a network failure.
    const authMessage =
      response.status === 401
        ? "انتهت جلسة الدخول. سجّل الدخول من جديد لفتح محفظتك."
        : response.status === 403
          ? "هذا الحساب غير مخول بدخول المحفظة."
          : "";
    // A followed Access challenge must never masquerade as a successful API
    // response. The AJAX header normally makes Access return a direct 401.
    if(response.redirected && response.url &&
      (response.url.includes("/cdn-cgi/access/") || new URL(response.url).hostname.endsWith(".cloudflareaccess.com")))
      throw Object.assign(new Error("انتهت جلسة الدخول. سجّل الدخول من جديد لفتح محفظتك."),{code:401,uncertain:writing});
    let body;
    try {
      body = await response.json();
    } catch {
      throw Object.assign(new Error(authMessage || "تعذر قراءة رد الخادم. أعد المحاولة."), {
        code: response.status,
        uncertain: writing,
      });
    }
    if (!response.ok) {
      const retryable =
        [401, 403, 408, 425, 429].includes(response.status) ||
        response.status >= 500;
      if (prepared && !retryable) finishWrite(prepared.key);
      throw Object.assign(new Error(body.error || "لم تكتمل العملية"), {
        code: response.status,
        uncertain: writing && retryable,
      });
    }
    if (prepared) finishWrite(prepared.key);
    return body;
  } finally {
    clearTimeout(timer);
  }
}
