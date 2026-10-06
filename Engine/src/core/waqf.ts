/**
 * الوقف — the pausal form of a word.
 *
 * The corpus stores every word as it sounds IN FLOW: tanween carries its noon
 * (or the sound it assimilates into) and every final short vowel is spoken,
 * because the next word is coming. But a reciter may stop on any word, and
 * stopping changes the ending — that is a rule of recitation, not a fault:
 *
 *   - tanween fath  →  a long alif            نَارًا  → "naaraa"
 *   - tanween damm/kasr → dropped             لَهَبٍ  → "lahab"
 *   - any other final short vowel → dropped   بِسمِ  → "bism"
 *
 * The corpus already writes ayah-END words in exactly this pausal form (the
 * stop at an ayah is the norm), which is why stopping there was always green —
 * and why `atAyahEnd` must be passed: such a word is ALREADY stopped, so there
 * is nothing to derive, and its plain text still carries the tanween mark that
 * would otherwise send these rules reading a pausal form as a flowing one.
 * Stop one word earlier and the engine used to charge the full substitution
 * price for every letter of the difference: measured on a real recording, the
 * same reciter's نَارًا was WRONG (distance 0.5) stopped on mid-ayah and 0.0
 * run into ذَاتَ thirty seconds later. 41,146 of the 71,197 mid-ayah words
 * (58%) change their sound when stopped on; tanween fath is merely the
 * loudest case, swapping up to three noons for an alif at 1.0 each.
 *
 * `pausalPhonemes` derives the stopped form from the flowing form. The
 * ORTHOGRAPHY decides which rule applies — the phonemes alone cannot, because
 * a tanween's noon and a word's own final ن look identical there. Only when
 * the plain text carries a tanween mark is the trailing letter run stripped
 * (نںم۾وۥيۦلر — the noon itself or whatever the next word assimilated it
 * into), and that run always trails the final short vowel, so the strip can
 * never eat a letter of the word's own body.
 *
 * Returns null whenever stopping does not change the sound (already ends
 * closed, or in a long vowel) or the shape is not one it is sure about —
 * null means "judge against the flowing form only", which is exactly the
 * behaviour before this file existed. Unsure here must fail SAFE, not lenient.
 *
 * ta marbuta: a stop turns ةً / ةٌ / ةٍ into "ah", not an alif — so a word
 * containing ة takes the dropped-tanween rule whatever its mark. The final
 * spoken ت vs the reciter's ه is left to the cost table, where they are
 * already 0.25-neighbours (the ةهت group); over a whole word that lands well
 * under `okDistance`. Not modelled further until a recording says otherwise.
 *
 * WHERE IT IS USED — verdicts.ts, and only there. The word is judged against
 * whichever of the two forms is nearer, and only when the reciter actually
 * PAUSED after it (the gap test lives there). The online tracker's table is
 * untouched: during a stop it briefly pays the flowing-form price, which over
 * the hold window is a rate of ~0.1 against the 0.45 gate — measured on the
 * نَارًا recording, where the cursor never moved wrongly.
 */

const FATHA = "َ";
const DAMMA = "ُ";
const KASRA = "ِ";
const HARAKAT = FATHA + DAMMA + KASRA;
/**
 * What a tanween's noon can appear as in the flowing phonemes: itself (ن,
 * and the model's ں), or the letter the next word assimilated it into —
 * يومل ر and the model's ۥۦ۾ variants. Always a trailing run after the
 * word's final short vowel.
 */
const CLUSTER = new Set("نںم۾وۥيۦلر");

const FATHATAN = "ً";
const DAMMATAN = "ٌ";
const KASRATAN = "ٍ";
const TA_MARBUTA = "ة";

/**
 * The word's phonemes as they would sound stopped on, or null when stopping
 * changes nothing — null is always the safe answer.
 *
 * @param phonemes   the flowing form, from the corpus
 * @param plain      the word's plain Unicode text, which carries the tanween
 * @param atAyahEnd  true for the last word of an ayah, which the corpus
 *                   already stores stopped — always null, never a derivation.
 *                   No string test can stand in for this: مُّسْتَمِرٍّ ends its
 *                   ayah as ممممُستَمِرر, and its own doubled ر preceded by the
 *                   tanween's kasra is indistinguishable from an assimilated
 *                   noon. Reading it as flowing derived ممممُستَم — a stem a
 *                   truncated recitation could then match.
 */
export function pausalPhonemes(phonemes: string, plain: string, atAyahEnd: boolean): string | null {
  if (atAyahEnd || phonemes.length < 2) return null;

  const fathatan = plain.includes(FATHATAN);
  const tanween = fathatan || plain.includes(DAMMATAN) || plain.includes(KASRATAN);

  let out: string | null = null;
  if (tanween) {
    // The noon appears as a run of ONE repeated symbol — itself, or the single
    // letter the next word assimilated it into. Walking a MIXED run would step
    // out of the cluster and into the word's own body: an ayah-END word is
    // already stored pausal, so عَظِيمٌ is عَظِۦۦۦۦم, and a greedy walk ate its
    // م and its long ۦۦۦۦ to leave عَظ. Measured on the corpus: 716 words,
    // every one an ayah end. Same-symbol only, and the harakah check below is
    // the second lock.
    const tail = phonemes[phonemes.length - 1];
    let end = phonemes.length;
    if (CLUSTER.has(tail)) while (end > 1 && phonemes[end - 1] === tail) end--;
    const stem = phonemes.slice(0, end);
    const last = stem[stem.length - 1];
    // The vowel the stem ends on must be the one this tanween is BUILT on —
    // fatha for ً, damma for ٌ, kasra for ٍ. Any other vowel means the sound is
    // not the flowing form this rule reads, and the commonest reason is that
    // the word sits at an AYAH END, where the corpus already stores the pausal
    // form while the plain text keeps its tanween mark: عَسِرٌ is stored عَسِر,
    // and a rule reading it as flowing derived عَس. Measured: every ayah-end
    // word now derives nothing, which is the invariant `waqf.test.ts` pins.
    const vowel = fathatan ? FATHA : plain.includes(DAMMATAN) ? DAMMA : KASRA;
    if (last !== vowel) {
      out = null;
    } else if (fathatan && !plain.includes(TA_MARBUTA)) {
      // نَاارَںںں → نَاارَاا.
      out = stem + "اا";
    } else {
      // لَهَبِوو → لَهَب · حَبڇلُ → حَبڇل · …ةً likewise.
      out = stem.slice(0, -1);
    }
  } else if (HARAKAT.includes(phonemes[phonemes.length - 1])) {
    // بِسمِ → بِسم: إسكان الموقوف عليه.
    out = phonemes.slice(0, -1);
  }

  if (out === null || out.length === 0 || out === phonemes) return null;
  return out;
}
