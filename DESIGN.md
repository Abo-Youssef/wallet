# محفظتي: مساحة هادئة

## Approved direction

اعتمد المستخدم الاتجاه الثاني «مساحة هادئة» بتاريخ 15 أكتوبر 2026، وأضاف شرط RTL ومحاذاة النصوص إلى منتصف البطاقات. المرجع البصري المولّد عالي الدقة هو اتجاه التنفيذ المعتمد؛ لا يحتاج المنتج أصول صور داخل الواجهة.

## Scene and theme

المساعد يراجع ويُدخل بيانات من مكتب مضاء عبر شاشة كمبيوتر، والمدير يراجع المحفظة خلال اليوم عبر هاتفه. سطح فاتح دافئ قليلًا، كتابة فحمية، ولون برتقالي محروق محدود للأفعال الأساسية والحالة النشطة. ألوان دلالية خضراء وحمراء للمبالغ والحالات مع نصوص شارحة.

## Color strategy

Restrained. Design tokens use OKLCH. Surface near-white with warm-gray tint, dark neutral ink, burnt-orange primary, sage success, rust warning, and muted red danger. Brand color carries controls rather than large decorative surfaces.

## Typography

System Arabic-capable sans stack: Segoe UI, Tahoma, Arial, sans-serif. Fixed rem scale, generous Arabic line-height, tabular numeric values. Main content 1rem, supporting copy 0.875rem, section headings 1.125rem, page headings around 1.75rem. Card text, labels and numeric values are centered. Numeric/date fields preserve LTR isolation inside RTL documents.

## Layout

Desktop uses a horizontal top navigation and work area, not a side rail. Assistant work list is paired with a concise summary; manager's monthly statement groups scheduled obligations separately from actual cash flows. Mobile navigation moves to the bottom, content becomes one column, and cards remain centered. Lists and separators do most grouping; avoid nested decorative cards.

## Controls and states

Minimum comfortable 44px touch controls, explicit labels, strong focus outlines. Same visual vocabulary for buttons and filters across the app. Modals are reserved for existing editing/detail flows, use accessible headings, focus trapping, background inertness and focus return. Empty/error/loading/confirmation states carry useful actions. No invented dates, totals or timeline hours.

## Reference ingredients

Printed agenda hierarchy, mobile Settings list clarity, horizontal toolbar organization. The approved mock's warm gray background, orange action control, horizontal desktop navigation, compact mobile statement and agenda order carry into the implementation. Raster text, sample people, invented settings controls and mock numerical inconsistencies do not.
