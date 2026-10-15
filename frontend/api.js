import { prepareWrite, finishWrite } from "../public/writes.mjs";
export async function request(path, method = "GET", payload, actor = "") {
  const writing = method !== "GET",
    options = { method, headers: {} };
  let prepared;
  if (writing) {
    prepared = await prepareWrite(path, method, payload ?? {}, actor);
    options.headers = {
      "Content-Type": "application/json",
      "X-Mahfazati-Action": "1",
    };
    options.body = JSON.stringify(prepared.body);
  }
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
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
    let body;
    try {
      body = await response.json();
    } catch {
      throw Object.assign(new Error("تعذر قراءة رد الخادم. أعد المحاولة."), {
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
