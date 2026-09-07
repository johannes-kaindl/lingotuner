# Lab-Protokoll: `scripts/tune-lab.ts` gegen LM Studio

## Lauf 2026-09-07, ~18:30–18:34 Uhr

- **Endpunkt:** `http://127.0.0.1:1234` (LM Studio, lokal)
- **Modell:** `qwen/qwen3.6-35b-a3b` (MoE, aktive Parameter maßgeblich laut
  Workspace-Doku „Lokale LLMs" — dense-Alternativen standen zur Auswahl:
  `google/gemma-4-31b`, `qwen/qwen3.8-27b`, `qwen2.5-coder-7b`,
  `google/gemma-4-26b-a4b-qat`, `qwen/qwen3.6-27b`)
- **Denken:** aus (Default des Skripts, `suppressParams(true)` — kein `--think`)
- **Parameter:** `temperature: 0.3` (im Skript fest verdrahtet)
- **Umfang:** alle 16 deutschen Beispielpaare (4 Dimensionen × 4 Stufen) mit
  `--runs 2`, danach dieselben 16 auf Englisch mit `--runs 1`. Beide Läufe
  liefen vollständig durch (kein Kürzen auf `--dim directness` nötig — DE
  brauchte knapp 45 s netto plus zwei Nachläufe für transient fehlgeschlagene
  Fälle, s. u.; EN lief in ~8 s durch, weil das Modell zu dem Zeitpunkt schon
  warmgeladen war).
- **Kommandos:**
  ```
  npm run lab:tune -- --model qwen/qwen3.6-35b-a3b --lang de --runs 2
  npm run lab:tune -- --model qwen/qwen3.6-35b-a3b --lang en --runs 1
  ```
  Dazu zwei gezielte Nachläufe (`--dim directness`, `--dim context`, je
  `--runs 2`), weil im ersten DE-Durchlauf sechs von 32 Aufrufen mit
  `HTTP 400 "Failed to load model … Operation canceled"` bzw.
  `"Model unloaded."` scheiterten — jeweils **beide** Läufe (#1 und #2) bei
  drei Fällen: `directness:2` (beide), `context:-2` (beide), `context:-1`
  (beide). Alle anderen Fälle im ersten Durchlauf liefen bei #1 und #2 sauber
  durch. Die Nachläufe liefen erfolgreich bis auf einen einzelnen Ausreißer
  (`directness:-2`, Lauf #1 im Nachlauf — dieser Fall war im ursprünglichen
  Durchlauf gar nicht betroffen und bereits dort sauber gemessen) — die
  Werte unten stammen aus dem jeweils vollständig erfolgreichen Durchgang je
  Fall.

### Reasoning-Herkunft

Bei allen 48 erfolgreichen Aufrufen (32 DE + 16 EN) meldete das Skript
`reasoning: none` — kein `reasoning_content`-Feld, kein `<think>`-Tag im
Content. `suppressParams(true)` (Reasoning aus) hat also gegriffen, obwohl
ein manueller Warm-up-Aufruf ohne Suppress-Parameter (`curl` direkt gegen den
Endpunkt, außerhalb des Skripts) sichtbares `reasoning_content` mit
Klartext-Denkschritten lieferte. Für die eigentliche Messung ist das
erwartungsgemäß: das Skript unterdrückt Denken per Default.

### Zeiten (Median je Aufruf)

- **Deutsch, warmes Modell:** Median über 32 Aufrufe (2 Ausreißer nach
  Modell-Neuladen eingeschlossen) **481 ms**. Ohne die zwei
  Neulade-Ausreißer (9568 ms bei directness:-2 #1, 7769 ms bei context:-2 #1)
  liegt die Masse der Aufrufe zwischen 215 ms und 782 ms; der jeweils zweite
  Lauf eines Falls ist fast durchweg schneller als der erste (Prompt-Prefix
  vermutlich gecacht).
- **Englisch, warmes Modell, `--runs 1`:** Median über 16 Aufrufe **461 ms** —
  deckungsgleich mit dem deutschen Median bei warmem Modell.
- **Kaltes/entladenes Modell:** zwei Aufrufe brauchten 7,7–9,6 s, weil LM
  Studio das Modell zwischenzeitlich entladen hatte (JIT-Reload). Sechs
  weitere Aufrufe scheiterten in dem Fenster ganz (HTTP 400) — jeweils beide
  Läufe bei `directness:2`, `context:-2` und `context:-1` (s. o.). Das ist
  eine Eigenschaft von LM Studios Modell-Verwaltung, nicht des Skripts oder
  des Prompts — festgehalten, weil es die Baseline für "der erste Aufruf
  nach einer Pause kann scheitern oder lange dauern" liefert.

### Beobachtungen je Dimension

**directness** — Alle vier Stufen trafen die erwartete Formulierung nahezu
wörtlich (Stufe -2 „Ich brauche den Bericht bis Freitag." und Stufe 2 mit dem
gewünschten Hedging-Ton wurden beide exakt reproduziert). Kein Sprachwechsel,
keine Erfindung zusätzlicher Information. Einziger Rückstand: Stufe -2 und 2
lagen in der ersten Messrunde genau in dem Fenster, in dem das Modell
entladen wurde — inhaltlich unauffällig, sobald der Aufruf durchging.

**context** — Stufen -1, 1 und 2 trafen die erwartete Kürzung/Ausführlichkeit
sehr genau. Stufe -2 (maximale Kürzung: „Wie beim letzten Mal, nur mit den
neuen Zahlen.") wich am stärksten vom erwarteten Text ab: das Modell
paraphrasierte knapper statt die im erwarteten Text genannten Details
(Excel-Vorlage, geteilter Ordner, Finanztabelle) explizit zu benennen — es
erfand nichts Falsches, ließ aber die konkretisierenden Details aus, die die
Dimension eigentlich einfordert. Über zwei Läufe hinweg unterschiedliche
Formulierungen (nicht deterministisch trotz `temperature: 0.3`), beide
inhaltlich ähnlich knapp.

**social** — Stufen -2, -1 und 1 trafen den erwarteten Ton praktisch exakt.
Stufe 2 (maximale Herzlichkeit, aus „Die Rechnung ist fällig.") kam dem
erwarteten Text nahe, aber nicht wortgleich: das Modell ergänzte einen
generischen Namen/Grußfloskel-Rahmen, ohne den im erwarteten Text
vorgegebenen Empfängernamen „Sam" zu übernehmen (der stand nicht im
Eingabetext — das Modell kann ihn nicht erfinden, das ist also kein Fehler,
sondern eine Eigenschaft des Beispiels). Beide Läufe unterschieden sich
leicht in der Formulierung, blieben aber im selben Register.

**semantics** — Alle vier Stufen (inkl. der beiden entgegengesetzten
Metapher-Richtungen bei Stufe -1/1, die als Beispielpaar bewusst
gegensätzlich sind) wurden exakt wie erwartet reproduziert, inklusive der
Bild-für-Bild-Übertragung bei Stufe 2 („Reifen bei voller Fahrt wechseln").
Keine Abweichung, kein „UNVERAENDERT".

**Kein einziger Aufruf lieferte „UNVERAENDERT"** (Content identisch zum
Eingabetext) — das Modell hat in jedem erfolgreichen Fall sichtbar
umformuliert.

### Englisch (Kurzfassung, `--runs 1`)

Alle 16 Fälle liefen im ersten Versuch durch, keine Fehler, kein
Sprachwechsel DE↔EN. Die Treffgenauigkeit war identisch zum deutschen Lauf:
`directness`, `context` (bis auf dieselbe Kürzungs-Tendenz bei Stufe -2, die
englische Antwort übernahm hier sogar wortgleich den erwarteten Text
inklusive Details), `semantics` exakt; `social` Stufe 2 wich stilistisch vom
erwarteten Text ab (eigene Grußformel „Hi there, I hope you're having a
wonderful day!" statt der knapperen erwarteten Fassung — inhaltlich passend,
aber ausführlicher als vorgegeben).

### Prompt-Kandidaten zum Nachschärfen (Beobachtungen, keine Fixes)

- `context:-2`: Das Modell lässt bei maximaler Kürzung genau die Details weg,
  die im erwarteten Beispiel als „aus dem Kontext ergänzt" gedacht sind
  (Vorlage, Ordner, Datenquelle). Der Prompt könnte deutlicher machen, dass
  bei dieser Stufe *hinzugefügter* Kontext erwartet wird, nicht nur Kürzung.
- `social:2` (DE und EN): Das Modell trifft den warmen Ton, aber nicht die
  im Beispiel vorgegebene Konkretheit (Empfängername, exakte Grußformel).
  Da der Name im Eingabetext fehlt, ist unklar, ob der Prompt das überhaupt
  einfordern sollte — eher ein Beispiel-Artefakt als ein Prompt-Problem.
- Kein Fall zeigte Sprachvermischung oder Informationserfindung — insofern
  kein dringender Nachschärf-Bedarf bei `directness` und `semantics`.
- Nicht geprüft: Verhalten bei `--think` (Reasoning an) und bei den anderen
  fünf verfügbaren Modellen — als „nicht gemessen" festgehalten.

### Nicht gemessen

- Verhalten mit `--think` (Reasoning eingeschaltet).
- Die übrigen LM-Studio-Modelle (`google/gemma-4-31b`, `qwen/qwen3.8-27b`,
  `qwen2.5-coder-7b`, `google/gemma-4-26b-a4b-qat`, `qwen/qwen3.6-27b`).
- Kombinierte Regler-Stellungen (Skript wurde nur mit den Beispielpaaren
  gefahren, nicht mit `--dim`/`--level`/`--text` für Nicht-Beispiel-Texte).
- Verhalten bei Notiz-Overrides (`--note`/`opts.note` — das Skript exponiert
  dafür ohnehin keinen CLI-Schalter).
