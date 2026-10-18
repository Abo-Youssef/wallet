import React, {useRef,useState} from "react";
import {useWallet} from "../state/WalletProvider.jsx";
import {Modal,Button,Field,Empty,Money} from "../components/ui.jsx";
import {normalizeDigits} from "../../shared/numerals.mjs";
import {MAX_RESTORE_BYTES,MAX_RESTORE_LABEL} from "../../shared/backup-limits.mjs";

const tableNames = {entities:"الأصول والوحدات والعمال",agreements:"العقود والالتزامات",
  payments:"الدفعات",expenses:"الفواتير والحركات",tasks:"المهام",audit:"سجل العمليات",
  hidden_audit:"السجل المخفي",dismissed_alerts:"التنبيهات المتابعة",mutation_requests:"إيصالات الحفظ"};
function readFile(file) {
  return new Promise((resolve,reject) => {
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error("تعذرت قراءة الملف؛ اختره مجددًا."));
    reader.readAsText(file);
  });
}
export default function RestoreDialog() {
  const {data,api,mutate,canManageData,close,notify}=useWallet();
  const [backup,setBackup]=useState(null),[filename,setFilename]=useState(""),
    [preview,setPreview]=useState(null),[confirmation,setConfirmation]=useState(""),
    [pending,setPending]=useState(""),[error,setError]=useState(""),
    [uncertain,setUncertain]=useState(false),[done,setDone]=useState(false);
  const busy=useRef(false), attempt=useRef(null);
  const manager=data?.user?.role==="manager";
  const select=async event=>{
    if(busy.current||uncertain)return;
    const file=event.target.files?.[0];
    setBackup(null);setPreview(null);setConfirmation("");setError("");attempt.current=null;
    setFilename(file?.name??"");
    if(!file)return;
    if(file.size>MAX_RESTORE_BYTES){setError(`حد الملف داخل المتصفح ${MAX_RESTORE_LABEL}. للنسخ الأكبر استخدم أداة الاستعادة على الكمبيوتر حسب دليل الإعداد؛ لن تُحذف بياناتك بسبب حجم الملف.`);return;}
    busy.current=true;setPending("read");
    try{
      let content;
      try{content=JSON.parse(String(await readFile(file)).replace(/^\uFEFF/,""));}
      catch{throw new Error("الملف ليس نسخة JSON صالحة. لم تتغيّر أي بيانات.");}
      setBackup(content);
    }catch(failure){setError(failure.message);}
    finally{busy.current=false;setPending("");}
  };
  const check=async()=>{
    if(busy.current||!backup||!manager||uncertain)return;
    busy.current=true;setPending("check");setError("");setPreview(null);setConfirmation("");attempt.current=null;
    try{
      const result=await api("/api/backup/preview","POST",{backup});
      if(!result.ok)throw new Error("رُفضت النسخة: "+result.issues.map(issue=>issue.reason).join("؛ "));
      setPreview(result);
    }catch(failure){setError(failure.message);}
    finally{busy.current=false;setPending("");}
  };
  const restore=async()=>{
    if(busy.current||!preview||!manager||!canManageData||confirmation.trim()!=="استعادة")return;
    busy.current=true;setPending("restore");setError("");
    // Keep the identical payload/request ID on ambiguous network failures.
    attempt.current??={backup,checkpoint:preview.checkpoint,confirmation:"استعادة",request_id:crypto.randomUUID()};
    try{
      const result=await mutate("/api/backup/restore",attempt.current);
      setDone(true);setUncertain(false);
      notify(result.refreshed?"تمت الاستعادة وتحديث بيانات المحفظة":"تمت الاستعادة. حدّث البيانات لإظهار النتيجة.",!result.refreshed);
    }catch(failure){
      setError(failure.message);setUncertain(Boolean(failure.uncertain));
      if(!failure.uncertain){setPreview(null);setConfirmation("");attempt.current=null;}
    }finally{busy.current=false;setPending("");}
  };
  const recovery=async()=>{
    if(busy.current||!manager)return;
    busy.current=true;setPending("recovery");setError("");
    try{
      const content=await api("/api/backup/recovery");
      const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download="wallet-before-restore.json";
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notify("تم تنزيل نسخة الرجوع");
    }catch(failure){setError(failure.message);}
    finally{busy.current=false;setPending("");}
  };
  return <Modal title="استعادة نسخة احتياطية" onClose={close} busy={Boolean(pending)} uncertain={uncertain}>
    {!manager?<Empty>الاستعادة متاحة للمدير فقط.</Empty>:done?<>
      <p role="status">تمت الاستعادة بنجاح. حُفظت نسخة من البيانات السابقة للرجوع إليها.</p>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        <Button variant="secondary" disabled={Boolean(pending)} onClick={recovery}>تنزيل نسخة ما قبل الاستعادة</Button>
        <Button variant="primary" disabled={Boolean(pending)} onClick={close}>عرض المحفظة</Button>
      </div>
    </>:<div className="restore-flow">
      <p>اختر نسخة المحفظة، ثم افحص محتواها قبل الاستعادة. اختيار الملف وفحصه لا يغيّران بياناتك.</p>
      {!canManageData&&<p className="notice">يمكنك الفحص الآن. لتنفيذ الاستعادة، فعّل وضع المساعد من «المزيد» ثم افتح هذه النافذة.</p>}
      <Field label="ملف النسخة الاحتياطية" hint={`JSON · حتى ${MAX_RESTORE_LABEL} في المتصفح؛ النسخ الكبيرة تُستعاد بأداة الكمبيوتر`}>
        <input type="file" accept=".json,application/json" onChange={select} disabled={Boolean(pending)||uncertain}/>
      </Field>
      {filename&&<p className="muted restore-filename">{normalizeDigits(filename)}</p>}
      <Button variant="secondary" disabled={!backup||Boolean(pending)||uncertain} onClick={check}>
        {pending==="check"?"جارٍ فحص النسخة…":"فحص النسخة وعرض الملخص"}
      </Button>
      {preview&&<section aria-label="ملخص النسخة" className="restore-summary">
        <h3>ملخص النسخة</h3>
        <p>تاريخ التصدير: {new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Riyadh"}).format(new Date(preview.exported_at))} · إصدار {preview.source_schema}</p>
        <p className="muted">{preview.checksum==="verified"?"بصمة الملف مطابقة، والبيانات اجتازت الفحص.":"نسخة قديمة دون بصمة. اجتازت فحص البيانات؛ تأكد من مصدر الملف."}</p>
        <table>
          <thead><tr><th>البيانات</th><th>حاليًا</th><th>في النسخة</th></tr></thead>
          <tbody>{Object.entries(tableNames).map(([key,label])=><tr key={key}>
            <th scope="row">{label}</th><td>{preview.current_counts[key].toLocaleString("en-US")}</td><td>{preview.counts[key].toLocaleString("en-US")}</td>
          </tr>)}</tbody>
        </table>
        <p className="muted">أرصدة العقود والالتزامات في النسخة، شاملة الدفعات السابقة:</p>
        <dl className="restore-totals">
          {[["paid_in","المحصّل"],["remaining_in","المتبقي لنا"],["paid_out","المدفوع"],["remaining_out","المتبقي علينا"]].map(([key,label])=><div key={key}><dt>{label}</dt><dd><Money value={preview.totals[key]}/></dd></div>)}
        </dl>
        <p className="notice">ستُستبدل جميع بيانات المحفظة وسجلها بمحتوى هذه النسخة. أي تغييرات بعد تاريخها ستخرج من المحفظة. تُحفظ تلقائيًا نسخة رجوع من البيانات الحالية قبل الاستبدال، وتبقى حتى الاستعادة التالية.</p>
        <Field label="اكتب استعادة للتأكيد">
          <input value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off" disabled={Boolean(pending)||uncertain}/>
        </Field>
        <Button variant="danger" disabled={!canManageData||Boolean(pending)||confirmation.trim()!=="استعادة"} onClick={restore}>
          {pending==="restore"?"جارٍ الاستعادة…":uncertain?"إعادة المحاولة لتأكيد النتيجة":"تأكيد الاستعادة واستبدال البيانات"}
        </Button>
      </section>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      {uncertain&&<p role="status">لم يصل تأكيد الخادم. أعد المحاولة بالبيانات نفسها لتأكيد النتيجة دون تكرار الاستعادة.</p>}
      <div className="form-actions">
        <Button variant="secondary" disabled={Boolean(pending)} onClick={recovery}>تنزيل نسخة ما قبل آخر استعادة</Button>
        <Button variant="secondary" disabled={Boolean(pending)} onClick={close}>إلغاء</Button>
      </div>
    </div>}
  </Modal>;
}
