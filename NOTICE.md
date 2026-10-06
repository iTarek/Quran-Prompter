# Licensing

**The engine (`Engine/`) and the Quran Prompter (`QuranPrompter/`) are
licensed under the Quran-Lab No-Profit License 1.2 — the same license as the
model they run.** Each carries the text as its own `LICENSE`, identical to
[`LICENSES/Quran-Lab-NPL-1.2.txt`](LICENSES/Quran-Lab-NPL-1.2.txt).

# Third-party work in this repository

## Quran Lab — the recognition model and its phoneme reference

The speech model this engine runs, and the phoneme reference and token lexicon
it matches against, are Quran Lab's work, released under the **Quran-Lab
No-Profit License 1.2 (NPL-1.2)** — full text in
[`LICENSES/Quran-Lab-NPL-1.2.txt`](LICENSES/Quran-Lab-NPL-1.2.txt).

- **Source:** <https://huggingface.co/Quran-Lab/zipformer_p-arabic-v3>
- **Home:** <https://quranlab.ai/>

### What it covers here

| file | what it is |
|---|---|
| `quran_phoneme_zipformer.onnx` (not committed; fetched into `QuranPrompter/public/models/`, served by the site at `/models/`) | the model itself: `zipformer_p_arabic_v3.1` int8, a streaming Zipformer2-CTC — 72,705,392 bytes, sha256 `31755836528da336a6192121cd7bc82cb41752dddb65566fd000b89c8686da6b` |
| `Engine/data/quran.json` | generated from the model's `ordered_quran_phonemes.json` |
| `Engine/src/model/tokens.ts` | generated from the model's `tokens.txt` — the token lexicon |
| `Engine/src/model/zipformer-io.json` | the model's input/output shapes, read from the model file |
| `Engine/test/fixtures/decode.json` | a recording and the tokens the model decoded from it |

These files are distributed under NPL-1.2, with no additional or different
terms (section 7). The Work has no upstream components under other terms
(section 8).

### How the prompter meets its terms

- **Not for sale (§3, §9).** The prompter is free: no payment, subscription,
  paywall or advertising on it or on any feature the model powers.
- **Hosted service (§5).** prompter.alketab.app is offered free of charge.
- **The license travels with the work (§6, §7).** This file and the license
  text are in the repository, and the site serves the license beside the model
  it distributes: <https://prompter.alketab.app/licenses/quran-lab-npl-1.2.txt>.
- **Attribution (§6)** is not required. The About page credits Quran Lab
  anyway.

## QuranEnc.com — the translations of the meanings

The translations of the meanings the prompter shows under the ayah being
recited («افهم ما تتلو») are published by **QuranEnc.com — the Noble Quran
Encyclopedia (موسوعة القرآن الكريم)** and republished here, unmodified, under
its terms. They live in `Engine/data/translations/` and the site serves them at
`/data/translations/`. Regenerated, all at once, with
`npm run translations -w Engine` (`Engine/scripts/fetch-translations.mjs`).

| key | language | translator (en / ar) | version | source |
|---|---|---|---|---|
| `arabic_moyassar` | Arabic (العربية) | At-Tafsir Al-Muyassar / التفسير الميسر | none published — retrieved 2026-10-04 | <https://quranenc.com/en/browse/arabic_moyassar> |
| `english_saheeh` | English (English) | Noor International Center / مركز نور إنترناشونال | 1.1.2 | <https://quranenc.com/en/browse/english_saheeh> |
| `french_rashid` | French (Français) | Rachid Maach / رشيد معاش | 1.0.3 | <https://quranenc.com/en/browse/french_rashid> |
| `spanish_garcia` | Spanish (Español) | Isa Garcia / عيسى غارسيا | 1.0.2 | <https://quranenc.com/en/browse/spanish_garcia> |
| `urdu_junagarhi` | Urdu (اردو) | Muhammad Junagarhi / محمد جوناكرهي | 1.1.3 | <https://quranenc.com/en/browse/urdu_junagarhi> |
| `indonesian_affairs` | Indonesian (Indonesia) | Ministry of Religious Affairs / وزارة الشؤون الدينية | 1.0.1 | <https://quranenc.com/en/browse/indonesian_affairs> |
| `turkish_rwwad` | Turkish (Türkçe) | Rowwad Translation Center / مركز رواد الترجمة | 1.0.4 | <https://quranenc.com/en/browse/turkish_rwwad> |
| `german_bubenheim` | German (Deutsch) | Frank Bubenheim / فرنك بوبنهايم | 1.1.4 | <https://quranenc.com/en/browse/german_bubenheim> |

«لغات أخرى…» in Settings can also download any other translation on QuranEnc's
list straight from their API, onto the reciter's device, at the reciter's
request. Those are not shipped or stored in this repository; they are shown
under the same rules below, with the translator and version QuranEnc's list
gives.

At-Tafsir Al-Muyassar is served by QuranEnc's API but is not on its list, and
QuranEnc publishes **no version number** for it — not in the API, the sqlite
download or the page — so none is shown for it. The script records the date
the text was retrieved in the file, and keeps that date while the text is
unchanged.

### Their terms, and how the prompter meets them

- **Never modify, add to or delete the text.** The script writes each
  translation and footnote byte for byte, not even trimmed; the page renders
  it as runs of its own characters, and a test joins every ayah of every
  shipped file back to the original.
- **Footnotes are kept.** A marker like `[2]` stays in the text, exactly where
  it was, and opens its note on a tap. A note no marker points at (Urdu 2:285)
  gets its own «حاشية» button rather than being dropped.
- **Credit the translator and the source wherever the meaning is shown.**
  Under every meaning: translator · source. The source is written short
  there — «موسوعة القرآن» in Arabic, "QuranEnc" in English, plain text
  (Tarek's choice, 2026-10-04); if QuranEnc asks for "QuranEnc.com" in full,
  it is `meaningSourceName` in `QuranPrompter/src/strings.ts`. The About page
  names QuranEnc.com in full, links it, and lists every translator and version.
- **Show the version.** On the About page, beside each translator. Not under
  every meaning — Tarek's choice, 2026-10-05; if QuranEnc asks for it there,
  it is `writeCredit` in `QuranPrompter/src/ui/meaning.ts`.
- **No ads.** None anywhere; NPL-1.2 forbids them on anything the model powers.
- **Keep versions current.** One command refreshes every translation and
  reports any whose version moved.
- **Human translations only.** Nothing is generated, paraphrased or
  machine-translated; every word shown comes from QuranEnc.

## Fonts

Both are shipped unmodified in `QuranPrompter/public/fonts/`.

| font | files | owner | licence |
|---|---|---|---|
| **KFGQPC Hafs Smart** v0.08 — the mushaf face | `HafsSmart_08.ttf` | King Fahd Glorious Quran Printing Complex, <http://fonts.qurancomplex.gov.sa/> | The Complex's end-user licence: free to use, copy and distribute; never to be sold, modified or reverse-engineered. Text in [`LICENSES/KFGQPC-Hafs-Smart-EULA.txt`](LICENSES/KFGQPC-Hafs-Smart-EULA.txt), extracted verbatim from the font's own licence field |
| **Readex Pro** — the interface face | `ReadexPro-*.woff2` | © 2018 The Readex Pro Project Authors | SIL Open Font License 1.1 — [`LICENSES/OFL-1.1-ReadexPro.txt`](LICENSES/OFL-1.1-ReadexPro.txt) |

## Libraries

| library | licence | where |
|---|---|---|
| onnxruntime-web 1.29 (Microsoft) | MIT | shipped in the site's build: it runs the model in the browser |
| Vite, Vitest, happy-dom | MIT | build and tests only |
| TypeScript | Apache-2.0 | build only |

Each is an npm dependency, not copied into this repository; its licence comes
with it in `node_modules/`.

## Word recitation audio

Tapping a word plays that word's recitation from Quran.com's audio service,
`audio.qurancdn.com`, streamed at the reciter's request. None of it is stored
in this repository or redistributed by the site.

## Other sources

- `Engine/data/translit.json` and `Engine/src/model/pages.ts` come from the
  AlKetab app's own data.

## Tools

The code and documentation were written with **Claude Code** (Anthropic) as
an AI pair programmer, under Tarek Mansour's direction and review.
