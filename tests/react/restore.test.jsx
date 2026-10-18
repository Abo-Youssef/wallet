import React from "react";
import {beforeAll,beforeEach,afterEach,it,expect,vi} from "vitest";
import {render,screen,waitFor,cleanup,fireEvent} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RestoreDialog from "../../src/client/features/RestoreDialog.jsx";
const context=vi.hoisted(()=>({value:null}));
vi.mock("../../src/client/state/WalletProvider.jsx",async original=>({...await original(),useWallet:()=>context.value}));
const counts={entities:2,agreements:1,payments:1,expenses:1,tasks:0,audit:5,hidden_audit:0,dismissed_alerts:0,mutation_requests:5};
const preview={ok:true,counts,current_counts:{...counts,entities:3},checksum:"verified",source_schema:8,exported_at:"2026-10-17T10:00:00Z",
  totals:{paid_in:10000,remaining_in:110000,paid_out:0,remaining_out:0},checkpoint:{revision:1,generation:"",digest:"abc",checked_at:"2026-10-17T10:00:00Z"}};
beforeAll(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
});
beforeEach(()=>{
  context.value={data:{user:{role:"manager"}},canManageData:true,api:vi.fn().mockResolvedValue(preview),
    mutate:vi.fn().mockResolvedValue({saved:true,refreshed:true}),close:vi.fn(),notify:vi.fn()};
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const file=(text='{"sample":true}',name="نسخة.json")=>new File([text],name,{type:"application/json"});
async function checked(user){
  await user.upload(screen.getByLabelText("ملف النسخة الاحتياطية"),file());
  await waitFor(()=>expect(screen.getByRole("button",{name:"فحص النسخة وعرض الملخص"})).toBeEnabled());
  await user.click(screen.getByRole("button",{name:"فحص النسخة وعرض الملخص"}));
  await screen.findByRole("region",{name:"ملخص النسخة"});
}
it("only managers see restoration controls",()=>{
  context.value.data.user.role="assistant";render(<RestoreDialog/>);
  expect(screen.queryByLabelText("ملف النسخة الاحتياطية")).not.toBeInTheDocument();
  expect(screen.getByText("الاستعادة متاحة للمدير فقط.")).toBeInTheDocument();
});
it("checks file and summary before exact confirmation, then restores once and offers recovery",async()=>{
  const user=userEvent.setup();render(<RestoreDialog/>);
  await checked(user);
  expect(context.value.api).toHaveBeenCalledWith("/api/backup/preview","POST",{backup:{sample:true}});
  expect(context.value.mutate).not.toHaveBeenCalled();
  expect(screen.getByRole("region",{name:"ملخص النسخة"})).toHaveTextContent("1,100");
  const confirm=screen.getByRole("button",{name:"تأكيد الاستعادة واستبدال البيانات"});
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText("اكتب استعادة للتأكيد"),"موافق");
  expect(confirm).toBeDisabled();
  await user.clear(screen.getByLabelText("اكتب استعادة للتأكيد"));
  await user.type(screen.getByLabelText("اكتب استعادة للتأكيد"),"استعادة");
  await user.dblClick(confirm);
  await screen.findByText(/تمت الاستعادة بنجاح/);
  expect(context.value.mutate).toHaveBeenCalledTimes(1);
  expect(context.value.mutate.mock.calls[0]).toEqual(["/api/backup/restore",expect.objectContaining({backup:{sample:true},checkpoint:preview.checkpoint,confirmation:"استعادة",request_id:expect.any(String)})]);
  expect(screen.getByRole("button",{name:"تنزيل نسخة ما قبل الاستعادة"})).toBeInTheDocument();
});
it("rejects invalid JSON and oversized files before any request",async()=>{
  const user=userEvent.setup();render(<RestoreDialog/>);
  await user.upload(screen.getByLabelText("ملف النسخة الاحتياطية"),file("{broken"));
  expect(await screen.findByRole("alert")).toHaveTextContent("JSON");
  await user.upload(screen.getByLabelText("ملف النسخة الاحتياطية"),file("x".repeat(10_000_001),"large.json"));
  expect(screen.getByRole("alert")).toHaveTextContent("10 MB");
  expect(context.value.api).not.toHaveBeenCalled();expect(context.value.mutate).not.toHaveBeenCalled();
});
it("changing the file discards the previous summary and confirmation",async()=>{
  const user=userEvent.setup();render(<RestoreDialog/>);await checked(user);
  await user.type(screen.getByLabelText("اكتب استعادة للتأكيد"),"استعادة");
  await user.upload(screen.getByLabelText("ملف النسخة الاحتياطية"),file('{"different":true}',"different.json"));
  expect(screen.queryByRole("region",{name:"ملخص النسخة"})).not.toBeInTheDocument();
  expect(screen.queryByLabelText("اكتب استعادة للتأكيد")).not.toBeInTheDocument();
  expect(context.value.mutate).not.toHaveBeenCalled();
});
it("a failed server inspection shows the issue and never offers restore",async()=>{
  context.value.api.mockResolvedValue({ok:false,issues:[{reason:"بصمة غير مطابقة"}]});
  const user=userEvent.setup();render(<RestoreDialog/>);
  await user.upload(screen.getByLabelText("ملف النسخة الاحتياطية"),file());
  await waitFor(()=>expect(screen.getByRole("button",{name:"فحص النسخة وعرض الملخص"})).toBeEnabled());
  await user.click(screen.getByRole("button",{name:"فحص النسخة وعرض الملخص"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("بصمة غير مطابقة");
  expect(screen.queryByLabelText("اكتب استعادة للتأكيد")).not.toBeInTheDocument();
});
it("manager read-only mode can inspect but cannot restore",async()=>{
  context.value.canManageData=false;
  const user=userEvent.setup();render(<RestoreDialog/>);await checked(user);
  await user.type(screen.getByLabelText("اكتب استعادة للتأكيد"),"استعادة");
  expect(screen.getByRole("button",{name:"تأكيد الاستعادة واستبدال البيانات"})).toBeDisabled();
  expect(context.value.mutate).not.toHaveBeenCalled();
});
it("uncertain saves lock the file and retry the identical request",async()=>{
  context.value.mutate.mockRejectedValueOnce(Object.assign(new Error("انقطع الاتصال"),{uncertain:true}));
  const user=userEvent.setup();render(<RestoreDialog/>);await checked(user);
  await user.type(screen.getByLabelText("اكتب استعادة للتأكيد"),"استعادة");
  await user.click(screen.getByRole("button",{name:"تأكيد الاستعادة واستبدال البيانات"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("انقطع الاتصال");
  expect(screen.getByLabelText("ملف النسخة الاحتياطية")).toBeDisabled();
  expect(screen.getByLabelText("اكتب استعادة للتأكيد")).toBeDisabled();
  await user.click(screen.getByRole("button",{name:"إعادة المحاولة لتأكيد النتيجة"}));
  await screen.findByText(/تمت الاستعادة بنجاح/);
  expect(context.value.mutate.mock.calls[1]).toEqual(context.value.mutate.mock.calls[0]);
});
it("stale confirmation requires a fresh inspection and cancel never restores",async()=>{
  context.value.mutate.mockRejectedValueOnce(Object.assign(new Error("تغيّرت البيانات"),{code:409}));
  const user=userEvent.setup();render(<RestoreDialog/>);await checked(user);
  await user.type(screen.getByLabelText("اكتب استعادة للتأكيد"),"استعادة");
  await user.click(screen.getByRole("button",{name:"تأكيد الاستعادة واستبدال البيانات"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("تغيّرت البيانات");
  expect(screen.queryByRole("region",{name:"ملخص النسخة"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"إلغاء"}));
  expect(context.value.close).toHaveBeenCalledTimes(1);expect(context.value.mutate).toHaveBeenCalledTimes(1);
});
