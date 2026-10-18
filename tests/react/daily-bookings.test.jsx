import React from "react";
import {beforeAll,afterEach,it,expect,vi} from "vitest";
import {render,screen,cleanup,fireEvent,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {WalletProvider,useWallet} from "../../src/client/state/WalletProvider.jsx";
import FinancialDialogs from "../../src/client/features/FinancialDialogs.jsx";
import DataPage from "../../src/client/pages/DataPage.jsx";
import {currentSummary} from "../../src/shared/finance.mjs";

beforeAll(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(cleanup);
const today="2026-10-17";
function Harness(){
  const wallet=useWallet();
  return <><button onClick={()=>wallet.setManagerAssistantMode(true)}>وضع المساعد</button><DataPage scoped />{wallet.dialog&&<FinancialDialogs key={JSON.stringify(wallet.dialog)} dialog={wallet.dialog}/>}</>;
}
function setup({manager=false,booked=false,personal=false}={}){
  const stored={today,month:"2026-10",user:{role:manager?"manager":"assistant",email:"review@example.test"},entities:[{id:"rest-house",kind:"property",property_type:"rest_house",name:"استراحة التجربة",version:0}],agreements:[],payments:[],expenses:[],tasks:[],alerts:[],archived_entities:[]};
  if(personal)stored.entities.push({id:"unit",kind:"unit",parent_id:"rest-house",name:"استخدام خاص",status:"personal_use"});
  if(booked){
    stored.agreements.push({id:"booking",kind:"rent",rental_mode:"daily",entity_id:"rest-house",title:"استراحة التجربة · "+today,status:"active",direction:"in",start_date:today,end_date:today,first_due_date:today,total_cents:100000,opening_cents:0,installment_count:1,frequency_months:1,version:1,counterparty:"أحمد"});
    stored.payments.push({id:"receipt",agreement_id:"booking",slot_index:0,amount_cents:40000,paid_at:today,active:1,created_at:today});
  }
  const snapshot=()=>({...structuredClone(stored),...currentSummary(stored.agreements,stored.payments,stored.expenses,stored.month,today)});
  const transport=vi.fn(async(path,method,body)=>{
    if(path.startsWith("/api/bootstrap"))return snapshot();
    if(path==="/api/bookings"){
      stored.agreements.push({id:"new-booking",kind:"rent",rental_mode:"daily",entity_id:body.entity_id,title:"استراحة التجربة · "+body.day,counterparty:body.counterparty,phone:body.phone,status:"active",direction:"in",start_date:body.day,end_date:body.day,first_due_date:body.day,total_cents:Number(body.total)*100,opening_cents:0,installment_count:1,frequency_months:1,version:0});
      return {id:"new-booking"};
    }
    if(path==="/api/bookings/booking/cancel"){
      Object.assign(stored.agreements[0],{booking_cancelled_at:today+"T12:00:00Z",booking_cancelled_by:"review@example.test",booking_cancel_note:body.note,version:2});
      return {id:"booking"};
    }
    throw new Error("Unexpected request "+path);
  });
  render(<WalletProvider initialData={snapshot()} transport={transport}><Harness /></WalletProvider>);
  return {stored,transport};
}

it("changes availability by selected day and prevents booking occupied/personal days in cards and table",async()=>{
  setup({booked:true});
  expect(screen.getByText("محجوز",{exact:true})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"حجز يوم"})).toBeDisabled();
  fireEvent.change(screen.getByLabelText("يوم حجوزات الاستراحات"),{target:{value:"2026-10-18"}});
  expect(screen.getByText("متاح",{exact:true})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"حجز يوم"})).toBeEnabled();
  fireEvent.click(screen.getByRole("button",{name:"عرض جدولي"}));
  expect(screen.getByText("متاح",{exact:true})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("يوم حجوزات الاستراحات"),{target:{value:today}});
  expect(screen.getByText("محجوز",{exact:true})).toBeInTheDocument();
});

it("saves a daily booking with Arabic input and refreshes the chosen day's status",async()=>{
  const {transport}=setup(),user=userEvent.setup();
  fireEvent.change(screen.getByLabelText("يوم حجوزات الاستراحات"),{target:{value:"2026-10-18"}});
  await user.click(screen.getByRole("button",{name:"حجز يوم"}));
  expect(screen.getByLabelText("يوم الحجز")).toHaveValue("2026-10-18");
  await user.type(screen.getByLabelText("اسم المستأجر"),"أحمد");
  fireEvent.change(screen.getByLabelText("رقم التواصل"),{target:{value:"٠٥٠٠١٢٣٤٥٦"}});
  fireEvent.change(screen.getByLabelText("قيمة اليوم (ر.س)"),{target:{value:"١٬٠٠٠٫٥٠"}});
  expect(screen.getByLabelText("قيمة اليوم (ر.س)")).toHaveValue("1,000.50");
  await user.click(screen.getByRole("button",{name:"حفظ الحجز"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(transport.mock.calls.find(([path])=>path==="/api/bookings")[2]).toMatchObject({day:"2026-10-18",entity_id:"rest-house",counterparty:"أحمد",phone:"0500123456",total:"1000.50"});
  expect(screen.getByText("محجوز",{exact:true})).toBeInTheDocument();
});

it("cancellation displays preserved money, requires explicit confirmation, saves then releases the day",async()=>{
  const {stored,transport}=setup({booked:true}),user=userEvent.setup();
  await user.click(screen.getByRole("button",{name:"عرض الحجز"}));
  expect(screen.queryByRole("button",{name:/تأكيد الإخلاء/})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"إلغاء الحجز",exact:true}));
  const dialog=screen.getByRole("dialog");
  expect(within(dialog).getByText("400",{exact:true})).toBeInTheDocument();
  expect(within(dialog).getByText("600",{exact:true})).toBeInTheDocument();
  const checkbox=within(dialog).getByRole("checkbox");
  expect(checkbox).toBeRequired();
  await user.click(within(dialog).getByRole("button",{name:"تأكيد الإلغاء وحفظ"}));
  expect(transport).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("سبب الإلغاء"),"طلب المستأجر");
  await user.click(checkbox);
  expect(stored.agreements[0].booking_cancelled_at).toBeUndefined();
  await user.click(within(dialog).getByRole("button",{name:"تأكيد الإلغاء وحفظ"}));
  await waitFor(()=>expect(screen.getByText(/الحجز ملغى. التحصيل والمديونية/)).toBeInTheDocument());
  expect(transport.mock.calls.find(([path])=>path.endsWith("/cancel"))[2]).toMatchObject({note:"طلب المستأجر",confirm_cancellation:true,expected_version:1});
  expect(stored.payments[0].amount_cents).toBe(40000);
  expect(stored.agreements[0].total_cents).toBe(100000);
  expect(screen.getByText("متاح",{exact:true})).toBeInTheDocument();
});

it("keeps manager read-only and personal-use rest houses unavailable",()=>{
  setup({manager:true,booked:true});
  expect(screen.queryByRole("button",{name:"حجز يوم"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"عرض الحجز"}));
  expect(screen.queryByRole("button",{name:"إلغاء الحجز",exact:true})).not.toBeInTheDocument();
  cleanup();
  setup({personal:true});
  expect(screen.getByRole("button",{name:"حجز يوم"})).toBeDisabled();
});
