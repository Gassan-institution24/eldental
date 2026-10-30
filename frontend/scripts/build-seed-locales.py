# Generates src/locales/{ar,en}/seed.json: names of system-seeded records (03 §1.1).
# Run: python scripts/build-seed-locales.py
import json
import os

here = os.path.dirname(os.path.abspath(__file__))

P = {
    'D0120': ('Periodic oral evaluation', 'فحص فموي دوري'),
    'D0140': ('Limited (problem-focused) evaluation', 'فحص محدود لمشكلة معينة'),
    'D0150': ('Comprehensive oral evaluation', 'فحص فموي شامل'),
    'D0180': ('Comprehensive periodontal evaluation', 'فحص لثوي شامل'),
    'D0210': ('Full-mouth X-rays', 'صور أشعة كاملة للفم'),
    'D0220': ('Periapical X-ray', 'صورة أشعة ذروية'),
    'D0274': ('Bitewing X-rays', 'صور أشعة عضّية'),
    'D0330': ('Panoramic X-ray', 'صورة بانورامية'),
    'D0367': ('CBCT scan', 'تصوير مقطعي مخروطي (CBCT)'),
    'D0470': ('Diagnostic casts', 'قوالب تشخيصية'),
    'D1110': ('Prophylaxis (cleaning) — adult', 'تنظيف وقائي — بالغ'),
    'D1120': ('Prophylaxis (cleaning) — child', 'تنظيف وقائي — طفل'),
    'D1206': ('Fluoride varnish', 'ورنيش الفلورايد'),
    'D1208': ('Topical fluoride', 'فلورايد موضعي'),
    'D1330': ('Oral hygiene instructions', 'تعليمات صحة الفم'),
    'D1351': ('Sealant — per tooth', 'مادة سادة للشقوق — لكل سن'),
    'D1510': ('Space maintainer', 'حافظ مسافة'),
    'D9910': ('Desensitising treatment', 'علاج حساسية الأسنان'),
    'D2140': ('Amalgam filling — 1 surface', 'حشوة أملغم — سطح واحد'),
    'D2150': ('Amalgam filling — 2 surfaces', 'حشوة أملغم — سطحان'),
    'D2160': ('Amalgam filling — 3 surfaces', 'حشوة أملغم — ثلاثة أسطح'),
    'D2330': ('Composite filling — 1 surface, anterior', 'حشوة تجميلية — سطح واحد، أمامية'),
    'D2331': ('Composite filling — 2 surfaces, anterior', 'حشوة تجميلية — سطحان، أمامية'),
    'D2332': ('Composite filling — 3 surfaces, anterior', 'حشوة تجميلية — ثلاثة أسطح، أمامية'),
    'D2335': ('Composite filling — 4+ surfaces, anterior', 'حشوة تجميلية — 4 أسطح فأكثر، أمامية'),
    'D2391': ('Composite filling — 1 surface, posterior', 'حشوة تجميلية — سطح واحد، خلفية'),
    'D2392': ('Composite filling — 2 surfaces, posterior', 'حشوة تجميلية — سطحان، خلفية'),
    'D2393': ('Composite filling — 3 surfaces, posterior', 'حشوة تجميلية — ثلاثة أسطح، خلفية'),
    'D2394': ('Composite filling — 4+ surfaces, posterior', 'حشوة تجميلية — 4 أسطح فأكثر، خلفية'),
    'D2510': ('Inlay / onlay', 'حشوة مصبوبة (إنلاي / أونلاي)'),
    'D2740': ('Crown — porcelain/ceramic', 'تاج خزفي'),
    'D2750': ('Crown — porcelain fused to metal', 'تاج خزف على معدن'),
    'D2790': ('Crown — zirconia', 'تاج زيركون'),
    'D2920': ('Re-cement crown', 'إعادة تثبيت تاج'),
    'D2930': ('Prefabricated crown — primary tooth', 'تاج جاهز — سن لبني'),
    'D2950': ('Core build-up', 'بناء قلب السن'),
    'D2954': ('Prefabricated post and core', 'وتد جاهز وبناء'),
    'D3110': ('Pulp cap', 'تغطية اللب'),
    'D3220': ('Pulpotomy', 'بتر اللب'),
    'D3310': ('Root canal — anterior', 'علاج عصب — سن أمامي'),
    'D3320': ('Root canal — premolar', 'علاج عصب — ضاحك'),
    'D3330': ('Root canal — molar', 'علاج عصب — طاحن'),
    'D3346': ('Root canal retreatment', 'إعادة علاج عصب'),
    'D3410': ('Apicoectomy', 'قطع ذروة الجذر'),
    'D4210': ('Gingivectomy', 'قطع اللثة'),
    'D4249': ('Crown lengthening', 'إطالة التاج'),
    'D4341': ('Scaling & root planing — per quadrant', 'تقليح وتسوية الجذور — لكل ربع'),
    'D4342': ('Scaling & root planing — limited', 'تقليح وتسوية الجذور — محدود'),
    'D4355': ('Full-mouth debridement', 'تنظيف شامل للفم'),
    'D4910': ('Periodontal maintenance', 'متابعة علاج اللثة'),
    'D5110': ('Complete denture — upper', 'طقم كامل — علوي'),
    'D5120': ('Complete denture — lower', 'طقم كامل — سفلي'),
    'D5213': ('Partial denture — upper', 'طقم جزئي — علوي'),
    'D5214': ('Partial denture — lower', 'طقم جزئي — سفلي'),
    'D5410': ('Denture adjustment', 'تعديل الطقم'),
    'D5750': ('Denture reline', 'تبطين الطقم'),
    'D6240': ('Bridge pontic', 'جسر — سن معلّق'),
    'D6750': ('Bridge abutment crown', 'جسر — تاج دعامة'),
    'D6930': ('Re-cement bridge', 'إعادة تثبيت جسر'),
    'D6010': ('Implant placement', 'زراعة سن'),
    'D6056': ('Implant abutment', 'دعامة الزرعة'),
    'D6065': ('Implant crown', 'تاج على زرعة'),
    'D6104': ('Bone graft at implant site', 'تطعيم عظمي لموقع الزرعة'),
    'D7951': ('Sinus lift', 'رفع الجيب الأنفي'),
    'D7140': ('Extraction — erupted tooth', 'خلع سن بازغ'),
    'D7210': ('Surgical extraction', 'خلع جراحي'),
    'D7220': ('Impacted tooth removal — soft tissue', 'خلع سن منطمر — نسيج رخو'),
    'D7240': ('Impacted tooth removal — full bony', 'خلع سن منطمر كليًا في العظم'),
    'D7250': ('Root remnant removal', 'إزالة بقايا جذر'),
    'D7310': ('Alveoloplasty', 'تسوية النتوء السنخي'),
    'D7510': ('Incision & drainage of abscess', 'شق وتصريف خراج'),
    'D7960': ('Frenectomy', 'قطع اللجام'),
    'D8010': ('Limited orthodontic treatment', 'تقويم محدود'),
    'D8080': ('Comprehensive ortho — adolescent', 'تقويم شامل — مراهق'),
    'D8090': ('Comprehensive ortho — adult', 'تقويم شامل — بالغ'),
    'D8670': ('Ortho adjustment visit', 'زيارة متابعة تقويم'),
    'D8680': ('Retainer', 'مثبّت بعد التقويم'),
    'D8090A': ('Clear aligners', 'تقويم شفاف'),
    'D9972': ('In-office whitening — per arch', 'تبييض في العيادة — لكل فك'),
    'D9975': ('Home whitening kit', 'حقيبة تبييض منزلية'),
    'D2962': ('Porcelain veneer', 'قشرة خزفية'),
    'D9970': ('Enamel microabrasion', 'صنفرة دقيقة للمينا'),
    'D9110': ('Emergency pain relief', 'علاج ألم طارئ'),
    'D9230': ('Nitrous oxide sedation', 'تخدير بأكسيد النيتروز'),
    'D9944': ('Night guard', 'واقي ليلي'),
    'D9999': ('Other procedure', 'إجراء آخر'),
}

CAT = {
    'diagnostic': ('Diagnostic', 'تشخيصي'),
    'preventive': ('Preventive', 'وقائي'),
    'restorative': ('Restorative', 'ترميمي'),
    'endodontics': ('Endodontics', 'علاج العصب'),
    'periodontics': ('Periodontics', 'أمراض اللثة'),
    'prosthodontics': ('Prosthodontics', 'تركيبات'),
    'oral_surgery': ('Oral surgery', 'جراحة الفم'),
    'orthodontics': ('Orthodontics', 'تقويم'),
    'implants': ('Implants', 'زراعة'),
    'cosmetic': ('Cosmetic', 'تجميلي'),
    'other': ('Other', 'أخرى'),
}

APPT = {
    'exam': ('Check-up', 'فحص'),
    'cleaning': ('Cleaning', 'تنظيف'),
    'filling': ('Filling', 'حشوة'),
    'root_canal': ('Root canal', 'علاج عصب'),
    'extraction': ('Extraction', 'خلع'),
    'crown': ('Crown / bridge', 'تاج / جسر'),
    'ortho': ('Ortho visit', 'زيارة تقويم'),
    'consultation': ('Consultation', 'استشارة'),
    'emergency': ('Emergency', 'طوارئ'),
}

TAX = {
    'exempt': ('Exempt (medical services)', 'معفى (خدمات طبية)'),
    'zero': ('Zero-rated', 'خاضع بنسبة صفر'),
    'standard': ('General sales tax 16%', 'ضريبة مبيعات عامة 16%'),
}

ROLES = {
    'owner': ('Owner', 'المالك'),
    'dentist': ('Dentist', 'طبيب أسنان'),
    'hygienist': ('Hygienist', 'أخصائي صحة فم'),
    'assistant': ('Dental assistant', 'مساعد طبيب'),
    'receptionist': ('Receptionist', 'موظف استقبال'),
    'accountant': ('Accountant', 'محاسب'),
    'hr_manager': ('HR manager', 'مدير موارد بشرية'),
}

COND = {
    'caries': ('Caries', 'تسوّس'),
    'filling': ('Filling', 'حشوة'),
    'inlay': ('Inlay', 'حشوة مصبوبة'),
    'sealant': ('Sealant', 'مادة سادة'),
    'fracture': ('Fracture', 'كسر'),
    'crown': ('Crown', 'تاج'),
    'rct': ('Root canal', 'علاج عصب'),
    'post': ('Post', 'وتد'),
    'missing': ('Missing', 'مفقود'),
    'implant': ('Implant', 'زرعة'),
    'bridge_pontic': ('Bridge pontic', 'جسر — معلّق'),
    'bridge_abutment': ('Bridge abutment', 'جسر — دعامة'),
    'veneer': ('Veneer', 'قشرة'),
    'impacted': ('Impacted', 'منطمر'),
    'mobility': ('Mobility', 'حركة السن'),
    'abscess': ('Abscess', 'خراج'),
}

STAFF = {
    'dentist': ('Dentist', 'طبيب أسنان'),
    'hygienist': ('Hygienist', 'أخصائي صحة فم'),
    'assistant': ('Assistant', 'مساعد'),
    'receptionist': ('Receptionist', 'استقبال'),
    'accountant': ('Accountant', 'محاسب'),
    'hr': ('HR', 'موارد بشرية'),
    'manager': ('Manager', 'مدير'),
    'other': ('Other', 'أخرى'),
}

GROUPS = {
    'procedure': P,
    'category': CAT,
    'appointmentType': APPT,
    'taxRate': TAX,
    'roles': ROLES,
    'condition': COND,
    'staffType': STAFF,
}

for i, lng in enumerate(['en', 'ar']):
    data = {g: {k: v[i] for k, v in items.items()} for g, items in GROUPS.items()}
    path = os.path.join(here, '..', 'src', 'locales', lng, 'seed.json')
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

print(len(P), 'procedures written')
