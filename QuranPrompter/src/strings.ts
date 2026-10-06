import { lang } from "./lang.js";

/**
 * Every user-facing string, in both languages. The Arabic is the iOS app's own
 * copy (ملقّن spelled consistently with the shadda); the English is that app's
 * translation where it has one, and written here where it does not.
 *
 * `EN` is typed against `AR`, so a string added to one and forgotten in the
 * other fails the build rather than silently rendering Arabic to an English
 * reader.
 */
const AR = {
  appTitle: "ملقّن القرآن",
  about: "عن ملقّن القرآن",
  help: "مساعدة",
  settings: "إعدادات الملقّن",
  back: "رجوع",
  startReciting: "ابدأ التلاوة",
  startLong: "ابدأ التلاوة الآن",
  contactUs: "تواصل معنا",
  modelLicense: "رخصة النموذج",
  listeningNow: "نستمع إلى التلاوة",
  listeningSub: "اقرأ من أي موضع في المصحف",
  prayingSub: "يميل البحث إلى الفاتحة",
  found: "وجدتُ موضعك",
  goingTo: "إلى موضعك",
  foundAyah: (ayah: string) => `الآية ${ayah}`,
  onDevice: "يُعالَج على جهازك فقط",
  ended: "انتهت السورة — عدتُ للاستماع",
  endedPray: "انتهت الركعة — أنتظر الفاتحة",
  continuing: (surah: string) => `تابع مع سورة ${surah}`,
  rakah: (n: string) => `الركعة ${n}`,
  ayahOf: (ayah: string, of: string) => `آية ${ayah} من ${of}`,
  page: "صفحة",
  restart: "العودة إلى البداية",
  tryAgain: "إعادة المحاولة",
  done: "تم",
  fontSize: "حجم الخط",
  fontFooter: "يمكنك أيضًا تكبير النص وتصغيره بإصبعين على شاشة الملقّن.",
  highlight: "لون التلوين",
  background: "الخلفية",
  languageTitle: "اللغة",
  palettes: { jungle: "غابة", dawn: "فجر", ocean: "بحر" },
  backdrops: { black: "أسود", midnight: "ليلي", graphite: "فحمي" },
  modeTitle: "وضع الملقّن",
  modesTitle: "أوضاع الملقّن",
  current: "الحالي",
  tipsTitle: "تلميحات",
  tipTap: "المس أي كلمة لتسمعها مُرتَّلة.",
  colorsIntro: "ألوان الكلمات أثناء التلاوة:",
  colorNames: {
    current: "الكلمة التي تقرؤها الآن",
    lead: "الكلمة التالية",
    ok: "قرأتها صحيحة",
    pending: "لم يتبيّن بعد",
    skipped: "لم تُقرأ",
    wrong: "قُرئت خطأً",
  },
  translit: "الكتابة بحروف لاتينية",
  translitFooter:
    "يظهر تحت كل كلمة نطقها بالحروف اللاتينية، بحجم أصغر. يفيد من لا يقرأ العربية بطلاقة. لا يظهر في وضع الحفظ لأنّ الكلمات فيه مخفيّة.",
  meaning: "معنى الآيات",
  meaningTitle: "ترجمة معاني الآيات",
  meaningFooter:
    "يظهر معنى الآية التي تتلوها أسفل الشاشة، ويتغيّر معك آيةً آية. تُحمَّل الترجمة التي تختارها مرة واحدة وتبقى على جهازك، فتعمل بعدها دون إنترنت. لا يظهر في وضع الحفظ.",
  meaningOff: "إيقاف",
  meaningOnDevice: "على جهازك",
  meaningSize: (mb: string) => `${mb} ميغابايت`,
  meaningProgress: (pct: string) => `${pct}٪`,
  meaningFailed: "تعذّر التحميل — تحقّق من اتصالك ثم حاول مرة أخرى",
  meaningSource: "الترجمات من موسوعة القرآن الكريم، تُعرض كما نُشرت دون أي تعديل.",
  meaningMore: "لغات أخرى…",
  meaningMoreSub: "كل ترجمات موسوعة القرآن، تُجلب منها مباشرة",
  meaningMoreLoading: "جارٍ جلب القائمة…",
  meaningMoreFailed: "تعذّر جلب القائمة — تحقّق من اتصالك",
  meaningAll: (n: string) => `${n} لغة في موسوعة القرآن`,
  meaningOf: (ayah: string) => `معنى الآية ${ayah}`,
  /** The source, as the credit under every meaning names it. */
  meaningSourceName: "موسوعة القرآن",
  meaningHide: "إخفاء المعنى",
  meaningShow: "إظهار المعنى",
  meaningExpand: "عرض المعنى كاملًا",
  meaningCollapse: "تصغير",
  meaningNote: "حاشية",
  meaningCloseNote: "إغلاق الحاشية",
  mistakeSound: "تنبيه صوتي عند الخطأ",
  mistakeSoundFooter:
    "في وضعي القراءة والحفظ: يُسمع تنبيه قصير عندما تُقرأ كلمة خطأً، بحدّ أقصى تنبيه واحد كل ثانية ونصف. لا يعمل في وضع الصلاة ولا في وضع التعرّف.",
  modes: {
    recognize: "وضع التعرّف",
    praying: "وضع الصلاة",
    reading: "وضع القراءة",
    memorizing: "وضع الحفظ",
  },
  /** One word each, under an icon: four of them share a phone's width. */
  modeTab: {
    recognize: "التعرّف",
    praying: "الصلاة",
    reading: "القراءة",
    memorizing: "الحفظ",
  },
  /** The line under the mode's name on the start screen. */
  modeShort: {
    reading: "يتعرّف على السورة مرّة ثم يبقى عليها، ويتابع مع التي تليها، ويحفظ موضعك.",
    recognize: "يجد موضعك أينما بدأت، ويبحث عنك من جديد بعد الصمت أو إذا انتقلت لسورة أخرى.",
    praying: "كل بحث جديد يميل إلى الفاتحة — فيتعرّف عليها أسرع في أول كل ركعة.",
    memorizing: "الكلمات مخفيّة بخطّ تحتها، وتنكشف كلمةً كلمة حين تقرؤها.",
  },
  modeHelp: {
    recognize:
      "يتعرّف على موضعك أينما بدأت، وإذا صمتّ ثم عدتَ بحث عنك من جديد، ويتابعك إذا انتقلت إلى سورة أخرى. مناسب لمتابعة تلاوة شيخ، ولحلقات التحفيظ، وللمراجعة.",
    praying:
      "مثل وضع التعرّف، إلا أنّ كل بحث جديد يميل إلى سورة الفاتحة، لأنّ ركعة انتهت وأخرى تبدأ. مناسب للصلاة إذا كنت تقرأ الفاتحة جهرًا، فيتعرّف عليها أسرع في أول كل ركعة.",
    reading:
      "الوضع الافتراضي. يتعرّف على السورة مرّة واحدة ثم يبقى عليها: لا ينقطع العرض بالصمت، وإذا انتهت السورة تابع مع التي تليها. ويحفظ آخر آية وصلت إليها لتكمل منها لاحقًا. مناسب للقراءة من المصحف خارج الصلاة.",
    memorizing:
      "الكلمات مخفيّة: يظهر مكان كل كلمة بخطّ تحتها، وتنكشف حين تقرؤها. مناسب لمراجعة الحفظ واختبار نفسك.",
  },
  resumeFrom: (surah: string, ayah: string) => `ابدأ من ${surah} آية ${ayah}`,
  chooseSurah: "اختر السورة",
  search: "ابحث باسم السورة أو رقمها",
  noMatch: "لا توجد سورة بهذا الاسم",
  lastHere: "آخر موضع",
  ayahsN: (n: string) => `${n} آية`,
  pageShort: (page: string) => `ص ${page}`,
  loadingModel: "جارٍ تحميل نموذج التعرّف على الصوت",
  loadingFirst: "في المرة الأولى فقط — يُحفظ على جهازك بعدها",
  install: {
    title: "ثبّت الملقّن على جهازك",
    body: "احفظه كتطبيق مستقل يفتح بملء الشاشة، بلا شريط عنوان، ويعمل دون إنترنت بعد التحميل الأول.",
    button: "تثبيت التطبيق",
    ios: "آيفون وآيباد: من متصفح ⁨Safari⁩ اضغط زر المشاركة، ثم «إضافة إلى الشاشة الرئيسية».",
    android: "أندرويد: افتح قائمة المتصفح، ثم «تثبيت التطبيق».",
    desktop: "الكمبيوتر: اضغط أيقونة التثبيت في شريط العنوان.",
  },
  info: {
    /** Under the app's name. `link` is the part that links to quranlab.ai. */
    poweredBy: { before: "يستخدم تقنيات ", link: "Quran Lab", after: " مفتوحة المصدر" },
    intro:
      "ابدأ التلاوة من أي موضع في القرآن وسيجد الملقّن مكانك، ويلوّن كل كلمة تقرأها، ويمرّر الآيات معك. حين تنتهي السورة أو تصمت، يعود للاستماع من جديد — كل ذلك بلا صوت ولا اهتزاز، ودون أن تلمس الهاتف.",
    trust: ["بلا حساب", "يعمل دون إنترنت", "صوتك لا يغادر جهازك"],
    when: "متى يفيدك؟",
    cases: [
      { title: "قيام الليل والتهجّد", detail: "ضع الهاتف أمامك بدل حمل المصحف، وأطِل القراءة بثقة." },
      { title: "السنن والنوافل", detail: "اقرأ ما لم تحفظه بعد في صلاتك دون أن تتوقف لتقلّب الصفحات." },
      { title: "متابعة تلاوة الشيخ", detail: "ضع الهاتف قرب الصوت، وسيتابع الملقّن القارئ آيةً بآية." },
      { title: "حلقات التحفيظ", detail: "يقرأ الطالب، ويرى المعلّم موضعه وكلماته على الشاشة." },
      { title: "لمن يحتاج خطًّا كبيرًا جدًا", detail: "نص كبير على خلفية سوداء، يُقرأ من بُعد." },
      {
        title: "لمن لا يُتقن قراءة العربية",
        detail: "فعّل «الكتابة بحروف لاتينية» من الإعدادات، فيظهر نطق كل كلمة تحتها وأنت تتلو.",
      },
      {
        title: "افهم ما تتلو",
        detail: "اختر لغتك من «معنى الآيات» في الإعدادات، فيظهر معنى الآية التي تتلوها أسفل الشاشة.",
      },
    ],
    meaningsTitle: "ترجمات المعاني",
    meaningsBody:
      "ترجمات معاني القرآن الكريم في الملقّن من موسوعة القرآن الكريم QuranEnc.com، تُعرض كما نُشرت دون أي تعديل، مع اسم المترجم ورقم الإصدار حيث يوجد:",
    privacyTitle: "صوتك لا يغادر جهازك.",
    privacyBody: "يعمل التعرّف على التلاوة داخل متصفحك بالكامل: لا يُرسل الصوت إلى أي خادم، ولا يحتاج الموقع إلى حساب.",
    needs: "يحتاج إلى السماح بالميكروفون ليعمل.",
    appLink: "تطبيق الكتاب للقرآن الكريم",
    privacy: "الخصوصية",
  },
  errors: {
    micDenied: {
      title: "لا يمكن الوصول إلى الميكروفون",
      body: "يرجى السماح بالوصول إلى الميكروفون من إعدادات المتصفح، ثم أعد تحميل الصفحة",
    },
    micUnavailable: {
      title: "تعذّر الوصول إلى الميكروفون",
      body: "تأكد من أن جهازك يحتوي على ميكروفون وأنه غير مستخدم من تطبيق آخر",
    },
    modelUnavailable: {
      title: "تعذّر تحميل نموذج التعرّف على الصوت",
      body: "تأكد من اتصالك بالإنترنت ومن توفّر مساحة كافية، ثم أعد تحميل الصفحة",
    },
    interrupted: { title: "توقّف تتبع التلاوة بشكل غير متوقع", body: "اضغط «إعادة المحاولة» للمتابعة" },
  },
};

const EN: typeof AR = {
  appTitle: "Quran Prompter",
  about: "About Quran Prompter",
  help: "Help",
  settings: "Prompter Settings",
  back: "Back",
  startReciting: "Start reciting",
  startLong: "Start reciting",
  contactUs: "Contact us",
  modelLicense: "Model license",
  listeningNow: "Listening to your recitation",
  listeningSub: "Recite from anywhere in the Mushaf",
  prayingSub: "Searching with Al-Fātiḥah first",
  found: "Found your place",
  goingTo: "Taking you there",
  foundAyah: (ayah: string) => `Ayah ${ayah}`,
  onDevice: "Processed on-device only",
  ended: "Surah ended — listening again",
  endedPray: "Rak‘ah ended — waiting for Al-Fātiḥah",
  continuing: (surah: string) => `Continuing into ${surah}`,
  rakah: (n: string) => `Rak‘ah ${n}`,
  ayahOf: (ayah: string, of: string) => `Ayah ${ayah} of ${of}`,
  page: "Page",
  restart: "Back to the start",
  tryAgain: "Try Again",
  done: "Done",
  fontSize: "Text size",
  fontFooter: "You can also pinch to resize the text on the prompter screen.",
  highlight: "Highlight",
  background: "Background",
  languageTitle: "Language",
  palettes: { jungle: "Jungle", dawn: "Dawn", ocean: "Ocean" },
  backdrops: { black: "Black", midnight: "Midnight", graphite: "Graphite" },
  modeTitle: "Prompter Mode",
  modesTitle: "Prompter Modes",
  current: "Current",
  tipsTitle: "Tips",
  tipTap: "Tap any word to hear it recited.",
  colorsIntro: "What the word colours mean while you recite:",
  colorNames: {
    current: "The word you are on now",
    lead: "The next word",
    ok: "Recited correctly",
    pending: "Not certain yet",
    skipped: "Not recited",
    wrong: "Recited wrongly",
  },
  translit: "Latin letters under each word",
  translitFooter:
    "Each word's pronunciation in Latin letters, smaller, under the Arabic. For reciters who do not read Arabic script fluently. It never shows in Review Mode, where the words are hidden.",
  meaning: "Meaning",
  meaningTitle: "Meaning of the ayahs",
  meaningFooter:
    "The meaning of the ayah you are reciting appears at the bottom of the screen and moves with you, ayah by ayah. The translation you pick downloads once and stays on your device, so it works offline. It never shows in Review Mode.",
  meaningOff: "Off",
  meaningOnDevice: "On device",
  meaningSize: (mb: string) => `${mb} MB`,
  meaningProgress: (pct: string) => `${pct}%`,
  meaningFailed: "Download failed — check your connection and try again",
  meaningSource: "Translations from QuranEnc, the Noble Quran Encyclopedia, shown exactly as published.",
  meaningMore: "More languages…",
  meaningMoreSub: "Every translation on QuranEnc, fetched from them directly",
  meaningMoreLoading: "Fetching the list…",
  meaningMoreFailed: "Could not fetch the list — check your connection",
  meaningAll: (n: string) => `${n} languages on QuranEnc`,
  meaningOf: (ayah: string) => `Meaning of ayah ${ayah}`,
  meaningSourceName: "QuranEnc",
  meaningHide: "Hide the meaning",
  meaningShow: "Show the meaning",
  meaningExpand: "Show the full meaning",
  meaningCollapse: "Collapse",
  meaningNote: "Note",
  meaningCloseNote: "Close note",
  mistakeSound: "Sound on a mistake",
  mistakeSoundFooter:
    "In Reading and Review Modes: a short cue when a word is recited wrongly, at most one every second and a half. It never sounds in Praying Mode or Recognize Mode.",
  modes: {
    recognize: "Recognize Mode",
    praying: "Praying Mode",
    reading: "Reading Mode",
    memorizing: "Review Mode",
  },
  modeTab: {
    recognize: "Recognize",
    praying: "Praying",
    reading: "Reading",
    memorizing: "Review",
  },
  modeShort: {
    reading: "Finds the surah once and stays on it, rolls into the next, and remembers your place.",
    recognize: "Finds you wherever you begin, and searches again after silence or a new surah.",
    praying: "Every new search leans toward Al-Fātiḥah — faster at the start of each rak‘ah.",
    memorizing: "Words are hidden as underlines, revealed one by one as you recite.",
  },
  modeHelp: {
    recognize:
      "It finds your place wherever you begin, searches again if you fall silent and come back, and follows you if you move to another surah. For following a reciter, memorization circles, and review.",
    praying:
      "Like Recognize Mode, except every new search leans toward Al-Fatihah, because one rak'ah has ended and another is beginning. For prayer, when you recite Al-Fatihah aloud, so it is recognized faster at the start of each rak'ah.",
    reading:
      "The default. It finds the surah once and stays on it: silence never ends the session, and when a surah ends it continues into the next. It also remembers the last ayah you reached, so you can pick up from there. For reading from the Mushaf outside prayer.",
    memorizing:
      "Words are hidden: each one keeps its place as an underline, and appears as you recite it. For reviewing what you have memorized and testing yourself.",
  },
  resumeFrom: (surah: string, ayah: string) => `Start from ${surah} ayah ${ayah}`,
  chooseSurah: "Choose a surah",
  search: "Search by name or number",
  noMatch: "No surah by that name",
  lastHere: "Last read",
  ayahsN: (n: string) => `${n} ayahs`,
  pageShort: (page: string) => `p. ${page}`,
  loadingModel: "Loading the speech recognition model",
  loadingFirst: "First visit only — it is saved on your device afterwards",
  install: {
    title: "Install the prompter on your device",
    body: "Save it as a standalone app that opens full screen, with no address bar, and works offline after the first load.",
    button: "Install app",
    ios: "iPhone and iPad: in Safari, tap the share button, then “Add to Home Screen”.",
    android: "Android: open the browser menu, then “Install app”.",
    desktop: "Desktop: click the install icon in the address bar.",
  },
  info: {
    poweredBy: { before: "Built on open-source technology from ", link: "Quran Lab", after: "" },
    intro:
      "Start reciting from anywhere in the Quran and the prompter finds your place, colors every word you recite, and scrolls the ayahs with you. When the surah ends or you fall silent, it goes back to listening — all without a sound or a vibration, and without touching the phone.",
    trust: ["No account", "Works offline", "Audio never leaves your device"],
    when: "When is it useful?",
    cases: [
      {
        title: "Night prayer and Tahajjud",
        detail: "Put the phone in front of you instead of holding a Mushaf, and recite at length with confidence.",
      },
      {
        title: "Sunnah and voluntary prayers",
        detail: "Recite what you have not memorized yet in your prayer, without stopping to turn pages.",
      },
      {
        title: "Following a sheikh's recitation",
        detail: "Place the phone near the sound and the prompter follows the reciter ayah by ayah.",
      },
      {
        title: "Memorization circles",
        detail: "The student recites; the teacher sees their place and their words on screen.",
      },
      {
        title: "For anyone who needs very large text",
        detail: "Large text on a black background, readable from a distance.",
      },
      {
        title: "For anyone who does not read Arabic well",
        detail: "Turn on “Latin letters under each word” in the settings.",
      },
      {
        title: "Understand what you recite",
        detail: "Pick your language under “Meaning” in the settings, and the meaning of the ayah you are reciting appears at the bottom of the screen.",
      },
    ],
    meaningsTitle: "Translations of the meanings",
    meaningsBody:
      "The translations of the meanings of the Quran come from QuranEnc.com, the Noble Quran Encyclopedia, shown exactly as published, with each translator and, where there is one, its version:",
    privacyTitle: "Your voice never leaves your device.",
    privacyBody: "Recognition runs entirely inside your browser: audio is never sent to any server, and there is no account.",
    needs: "Needs microphone permission to work.",
    appLink: "The AlKetab Quran app",
    privacy: "Privacy",
  },
  errors: {
    micDenied: {
      title: "Can't access the microphone",
      body: "Allow microphone access in your browser settings, then reload the page",
    },
    micUnavailable: {
      title: "The microphone is unavailable",
      body: "Check that your device has a microphone and that no other app is using it",
    },
    modelUnavailable: {
      title: "Could not load the speech recognition model",
      body: "Check your connection and that you have enough free space, then reload the page",
    },
    interrupted: { title: "Recitation tracking stopped unexpectedly", body: "Press “Try Again” to continue" },
  },
};

/** The active language's strings. Read at use time, never cached across a switch. */
export function t(): typeof AR {
  return lang() === "en" ? EN : AR;
}
