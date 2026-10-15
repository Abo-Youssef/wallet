# خطة تنفيذ محفظتي 1.3

Status: confirmed by user on 2026-10-15, direction 2 «مساحة هادئة», RTL and centered card text.

## Outcome and scope

تطوير متكامل للواجهة الحالية والوظائف المرتبطة بالمراجعة والتنفيذ، ضمن Cloudflare Workers + D1 وواجهة JavaScript خفيفة. المساعد على الكمبيوتر أساسًا، والمدير على الجوال أساسًا، مع دعم كليهما لكلا الجهازين. نسخة مصدر عاملة ومعاينة واختبارات؛ النشر الفعلي غير منفذ ضمن هذه المرحلة.

## Primary actions

المساعد يجد الاستحقاق الصحيح ويسجل التحصيل أو السداد دون تكرار. المدير يفهم وضع الشهر وما يحتاج متابعة، ثم يراجع التفاصيل أو يرسل مهمة.

## Approved capabilities

- إصلاح تحويل الأموال في الواجهة، وهوية الطلب بعد تعثر الدخول، وسياق الشهر أثناء التحميل.
- بحث متسق بالاسم والأرقام في البطاقات والجداول.
- قائمة دفعات الاتفاق وتفاصيلها وروابط التنبيهات إلى سجلاتها.
- كشف شهري للطباعة وتصدير الحركات CSV.
- إغلاق صريح للاتفاق المسدد، وإعادة فتحه ضمن ضوابط الأصل والإيجار، ثم أرشفة الأصل.
- فحص نسخ احتياطية مطابق لضوابط الجدولة والإغلاق.

## Interaction and states

Navigation and filters preserve logical keyboard focus. Financial forms label expected/actual values, required fields, errors and saved outcomes. Loading a new month must not label old totals with it. Search has clear empty results and reset. The original read-only standalone preview stays explicitly illustrative; a separate local review runner can exercise real API mutations with disposable synthetic data.

## Content and boundaries

اسم محفظتي محفوظ، الصلاحيات الحالية محفوظة، العملة ريال سعودي، التواريخ ميلادية وسياق الرياض. لا رواتب للعمال أو تحميل مستندات أو خدمة إشعارات خارجية أو تكاملات حسابات مالية. لا تعرض أزرارًا غير منفذة. مصادر الأرقام هي محرك الحساب الفعلي. إغلاق الإيجار يتطلب نهاية المدة وتسوية الرصيد.

## Visual direction and image decisions

Generated two high-fidelity direction boards using built-in image generation. User chose board 2 and required centered card text. The approved high-fidelity board is the visual reference for this existing-app redesign; no further direction exploration or raster UI assets are necessary. Follow DESIGN.md; correct mock numerical labels and render all text as semantic HTML.

## Implementation references

impeccable product, spatial-design, typography, responsive-design, interaction-design and ux-writing references. Validate mobile narrow, tablet/small laptop and wide desktop in the browser, then fix material findings.

## Open questions

None blocking local implementation. Real Cloudflare account configuration and production acceptance remain separate from local source verification.
