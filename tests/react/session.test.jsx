import React from "react";
import { act, cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WalletProvider, useWallet } from "../../src/client/state/WalletProvider.jsx";
import { request } from "../../src/client/api.js";
import { ACCESS_LOGOUT_PATH, LOGOUT_SIGNAL_KEY, navigateToAccessLogout } from "../../src/client/lib/session.js";
import App from "../../src/client/App.jsx";

const snapshot = (role="manager") => ({
  month:"2026-10",today:"2026-10-17",
  user:{role,email:role+"@example.test",name:"حساب اختبار"},
  entities:[],archived_entities:[],agreements:[],payments:[],expenses:[],dues:[],tasks:[],alerts:[],
  summary:{due_in:0,fulfilled_in:0,remaining_in:0,due_out:0,fulfilled_out:0,remaining_out:0,cash_in:0,cash_out:0,net:0,future_in:0,future_out:0},
});
const deferred = () => {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};
function setup({role="manager",transport=vi.fn(),logoutNavigate=vi.fn()}={}) {
  let current;
  function Probe(){current=useWallet();return null;}
  render(<WalletProvider initialData={snapshot(role)} transport={transport} logoutNavigate={logoutNavigate}><Probe/></WalletProvider>);
  return {state:()=>current,transport,logoutNavigate};
}
beforeAll(()=>{window.scrollTo=vi.fn();});
afterEach(()=>{
  cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  localStorage.clear();sessionStorage.clear();
});

describe("logout and authenticated session lifecycle",()=>{
  it("navigates at top level to the official same-origin Access logout endpoint",()=>{
    const replace=vi.fn();
    vi.stubGlobal("window",{location:{replace}});
    navigateToAccessLogout();
    expect(replace).toHaveBeenCalledExactlyOnceWith("/cdn-cgi/access/logout");
  });
  it.each(["manager","assistant"])("lets a %s leave from More without writing financial data",role=>{
    const transport=vi.fn(),logoutNavigate=vi.fn(),data=snapshot(role);
    render(<WalletProvider initialData={data} transport={transport} logoutNavigate={logoutNavigate}><App/></WalletProvider>);
    fireEvent.click(within(screen.getByRole("navigation",{name:"التنقل على الجوال"})).getByRole("button",{name:"المزيد"}));
    fireEvent.click(within(screen.getByRole("main")).getByRole("button",{name:"تسجيل الخروج"}));
    expect(logoutNavigate).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
    expect(screen.getByRole("heading",{name:"جارٍ تسجيل الخروج"})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"متابعة تسجيل الخروج"})).toHaveAttribute("href",ACCESS_LOGOUT_PATH);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByText("حساب اختبار")).not.toBeInTheDocument();
  });
  it("also exposes logout in the account menu",()=>{
    const logoutNavigate=vi.fn();
    render(<WalletProvider initialData={snapshot()} logoutNavigate={logoutNavigate}><App/></WalletProvider>);
    const header=screen.getByRole("banner");
    fireEvent.click(within(header).getByText("حساب اختبار",{selector:"summary strong"}));
    fireEvent.click(within(header).getByRole("button",{name:"تسجيل الخروج"}));
    expect(logoutNavigate).toHaveBeenCalledOnce();
  });
  it("clears drafts, feedback and manager work mode; preserves safe retry receipts and ignores double clicks",async()=>{
    const t=setup();
    const receipts='[["hash",{"id":"retry-id","version":3}]]';
    sessionStorage.setItem("wallet-pending-writes-v1",receipts);
    act(()=>{t.state().setManagerAssistantMode(true);t.state().open("payment");t.state().notify("قديم");});
    act(()=>{t.state().logout();t.state().logout();});
    expect(t.state()).toMatchObject({data:null,dialog:null,toast:null,managerAssistantMode:false,signingOut:true});
    expect(t.logoutNavigate).toHaveBeenCalledOnce();
    expect(localStorage.getItem(LOGOUT_SIGNAL_KEY)).toBeTruthy();
    expect(sessionStorage.getItem("wallet-pending-writes-v1")).toBe(receipts);
    await expect(t.state().api("/api/history")).rejects.toMatchObject({code:401});
    await expect(t.state().reload()).resolves.toBe(false);
    expect(t.transport).not.toHaveBeenCalled();
  });
  it("discards a bootstrap response that arrives after logout",async()=>{
    const pending=deferred(),t=setup({transport:vi.fn(()=>pending.promise)});
    let refreshed;
    act(()=>{refreshed=t.state().reload();});
    act(()=>t.state().logout());
    await act(async()=>{pending.resolve(snapshot());await refreshed;});
    expect(t.state().data).toBeNull();
    expect(t.state().loading).toBe(false);
    expect(t.state().signingOut).toBe(true);
  });
  it("does not announce a late write as saved or repopulate the screen after logout",async()=>{
    const pending=deferred(),t=setup({role:"assistant",transport:vi.fn(()=>pending.promise)});
    let result;
    act(()=>{result=t.state().mutate("/api/expenses",{amount:"10"}).catch(error=>error);});
    act(()=>t.state().logout());
    await act(async()=>{pending.resolve({ok:true});await result;});
    expect(await result).toMatchObject({code:401});
    expect(t.state().data).toBeNull();
    expect(t.state().toast).toBeNull();
    expect(t.transport).toHaveBeenCalledOnce();
  });
  it.each([401,403])("clears an account on a non-bootstrap %s and recovers read-only",async code=>{
    const transport=vi.fn().mockRejectedValueOnce(Object.assign(new Error("جلسة مرفوضة"),{code})).mockResolvedValueOnce(snapshot());
    const t=setup({transport});
    act(()=>{t.state().setManagerAssistantMode(true);t.state().open("payment");});
    await act(async()=>{await t.state().api("/api/history").catch(()=>{});});
    expect(t.state()).toMatchObject({data:null,dialog:null,errorCode:code,managerAssistantMode:false});
    await act(async()=>{await t.state().reload();});
    expect(t.state().data?.user.email).toBe("manager@example.test");
    expect(t.state().managerAssistantMode).toBe(false);
    expect(t.state().error).toBe("");
  });
  it("does not report success when a write commits but its refresh finds an expired session",async()=>{
    const transport=vi.fn().mockResolvedValueOnce({ok:true}).mockRejectedValueOnce(Object.assign(new Error("انتهت الجلسة"),{code:401}));
    const t=setup({role:"assistant",transport});
    let failure;
    await act(async()=>{failure=await t.state().mutate("/api/expenses",{amount:"10"}).catch(error=>error);});
    expect(failure).toMatchObject({code:401,uncertain:true});
    expect(t.state()).toMatchObject({data:null,toast:null,dialog:null});
  });
  it("does not let a delayed rejection from an old account erase a new account",async()=>{
    const pending=deferred(),next=snapshot("assistant");
    const transport=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(next);
    const t=setup({transport});
    const oldRequest=t.state().api("/api/history").catch(error=>error);
    await act(async()=>{await t.state().reload();});
    await act(async()=>{pending.reject(Object.assign(new Error("قديم"),{code:401}));await oldRequest;});
    expect(t.state().data).toEqual(next);
    expect(t.state().error).toBe("");
  });
  it("handles logout from another tab without rebroadcasting a loop",()=>{
    const t=setup(),write=vi.spyOn(Storage.prototype,"setItem");
    act(()=>window.dispatchEvent(new StorageEvent("storage",{key:LOGOUT_SIGNAL_KEY,newValue:"other-tab"})));
    expect(t.logoutNavigate).toHaveBeenCalledOnce();
    expect(t.state().data).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
  it("clears a back-forward cached snapshot before validating it again",async()=>{
    const pending=deferred(),t=setup({transport:vi.fn(()=>pending.promise)});
    act(()=>window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true})));
    expect(t.state().data).toBeNull();
    expect(t.state().loading).toBe(true);
    await act(async()=>{pending.reject(Object.assign(new Error("انتهت الجلسة"),{code:401}));});
    expect(t.state()).toMatchObject({data:null,loading:false,errorCode:401});
  });
  it("revalidates when returning to a visible tab and distinguishes network failure from expiry",async()=>{
    const transport=vi.fn().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(Object.assign(new Error("انتهت الجلسة"),{code:401}));
    const t=setup({transport});
    vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
    await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
    expect(t.state().data?.user.role).toBe("manager");
    expect(t.state().error).toBe("offline");
    await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
    expect(t.state().data).toBeNull();
    expect(t.state().errorCode).toBe(401);
  });
});
describe("Access-aware HTTP requests",()=>{
  it.each(["GET","POST"])("marks %s as AJAX with no cached protected responses",async method=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true})));
    vi.stubGlobal("fetch",fetch);
    await request("/api/session-test",method,method==="GET"?undefined:{value:1},"test@example.test");
    expect(fetch.mock.calls[0][1]).toMatchObject({cache:"no-store",credentials:"same-origin",headers:{"X-Requested-With":"XMLHttpRequest"}});
  });
  it("recognizes a followed Access login redirect rather than displaying its HTML",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({
      redirected:true,url:"https://wallet-test.cloudflareaccess.com/cdn-cgi/access/login",status:200,
      json:vi.fn(()=>{throw new Error("HTML challenge");}),
    }));
    await expect(request("/api/bootstrap")).rejects.toMatchObject({code:401});
  });
});
