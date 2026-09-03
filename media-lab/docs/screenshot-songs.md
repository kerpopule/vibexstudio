# Screenshot songs

Screenshot songs support two delivery modes.

## Catchy song (default)

Use this when the result should sound like a song rather than a literal reading.

- Reviewed screenshot text is source material, not a verbatim vocal contract.
- The local songwriter selects the strongest moments in screenshot order.
- Lyrics must contain at least two short verses and the same chorus written out at least twice.
- Lyric lines are capped at 16 words and the total lyric is capped at 180 words.
- The Music 3 caption explicitly requires pitched melodic singing, a repeated hook, instrumental transitions, and no spoken-word, recitative, narration, or rap.
- Screenshots use deterministic story-weighted timing because adapted lyrics do not reproduce every source sentence.

## Every word

Use this when every reviewed word must be performed in order. This mode keeps the deterministic literal-vocal Director gate and Whisper word alignment. Long prose may sound more like narration; that is an intentional trade-off, not the default.

## Auto duration

Auto is content-aware:

1. The UI recalculates whenever included text changes or a screenshot is included/excluded.
2. Song-first estimates assume the source will be compressed to roughly 48 percent of its prose word count, bounded to 60–180 lyric words.
3. After the songwriter produces the actual lyric, the server recalculates the Music 3 duration ceiling from the real lyric and section count.
4. Music 3 may end naturally before that ceiling. A shorter render is valid when the vocal contract passes; it is never stretched to an arbitrary requested length.
5. A manually selected duration remains an explicit override.

The maximum supported ceiling is three minutes. Auto favors enough space for melody, repeated hooks, instrumental transitions, and an outro instead of maximizing words per second.

## Director gates

- Written numbers and their spoken equivalents are normalized for ASR comparison.
- Only low-confidence Whisper hallucinations after the last matched lyric may be ignored.
- Confident extra vocals, missing passages, prompt leakage, and unordered lyrics still fail closed.
- Technical QA does not imply creative approval.
