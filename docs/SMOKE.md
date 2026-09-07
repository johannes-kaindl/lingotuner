# GUI-Smoke — LingoTuner gegen ein laufendes Obsidian

Erfüllt CORE-TEST-02 (b): die Prüfpunkte laufen gegen ein **laufendes** Obsidian über CDP,
nicht von Hand. Treiber: `scripts/gui-smoke.ts`, Fixture: `fixtures/vault/`, CDP-Brücke:
`../tools/obsidian-cdp/` (zentral im Dach — wird importiert, nie kopiert).

Der Lauf misst zwei Hälften: **A/B ohne Modell** (Panel, Quellen, Guards) und **C mit
Modell** (Stream, Statusanzeige, Ausgänge, Logbuch). Antwortet auf `http://127.0.0.1:1234`
kein Endpunkt, wird C **übersprungen und benannt** — nie still grün (CORE-TEST-19).

## Rezept: Zweitinstanz, eigenes Profil, eigener Port

Die reguläre Instanz auf `9222` gehört möglicherweise einer anderen Session. Sie wird
nicht angefasst — kein Attach, kein Quit, kein Fenster nach vorn. Der richtige Ort für
diesen Lauf ist eine Zweitinstanz: die Sperre hängt am **Profil**, nicht am Rechner.

Der Treiber misst im **eigenen Staging-Vault** (`$STAGING_VAULTS_DIR/lingotuner`), nie im
Arbeits-Vault. Wo dieses Verzeichnis liegt, sagt die Umgebung (`~/.zshenv`) und
`obsidian-plugins/AGENTS.md` § Staging-Vaults — **hier steht nur die Variable, nie ihr Wert**
(CORE-META-14; ein Beispielwert in der Doku ist ein zweiter Ort und gabelt die Konvention).

```bash
echo "$STAGING_VAULTS_DIR"                                   # muss gesetzt sein (~/.zshenv)
npm run build && npm run smoke:gui -- --setup                # Vault aus fixtures/vault/

UD=/tmp/obs-test-lingotuner; mkdir -p "$UD"
lsof -nP -iTCP:9341 -sTCP:LISTEN && echo "Port belegt — anderen nehmen"
node -e 'const p=process.env.STAGING_VAULTS_DIR+"/lingotuner";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{lingotuner:{path:p,ts:Date.now(),open:true}}}))' "$UD"

# Die Versionsnummer VOR dem Kopieren nachsehen — ein frisches Profil startet sonst mit der
# GEBUENDELTEN Obsidian-Version, und ein `|| true` liefe still ins Leere:
ls ~/Library/Application\ Support/obsidian/*.asar
cp ~/Library/Application\ Support/obsidian/obsidian-1.14.0.asar "$UD"/

/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9341 &
PID=$!                       # merken — SO wird sie beendet, nie mit pkill/killall/quit app

python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label lingotuner \
  --intent "GUI-Smoke Zweitinstanz :9341" --exclusive focus --ttl 300
npm run smoke:gui -- --port 9341
python3 ~/.claude/hooks/obsidian-cdp-lock.py release

kill "$PID"
```

Der Lock ist die **Eintrittskarte** des CDP-Guards, auch für die Zweitinstanz — ohne ihn
kommt niemand durch. `release` gehört unmittelbar hinter den Lauf; Committen und Doku
brauchen den Port nicht. Ist der Lock belegt: `acquire` im 5-Sekunden-Takt pollen, nicht
`status` beobachten.

**Beenden nur über die gemerkte PID.** `pkill -f Obsidian`, `killall Obsidian` und
`osascript … quit app "Obsidian"` träfen die reguläre Instanz auf 9222 und töteten die
Messreihe einer fremden Session; der CDP-Guard blockt sie ohnehin.

**Teil C braucht CORS — und der Endpunkt gehört dir nicht.** Ein lokaler Endpunkt ohne
`Access-Control-Allow-Origin` lässt den Preflight scheitern; das Plugin meldet das korrekt
(„Der Server ist erreichbar, aber der Browser hat den Stream blockiert (CORS)"), aber C ist
dann nicht messbar. Geprüft wird das **lesend**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:1234/v1/models          # laeuft er?
curl -s -i -X OPTIONS http://127.0.0.1:1234/v1/chat/completions \
  -H 'Origin: app://obsidian.md' -H 'Access-Control-Request-Method: POST' | head -5   # CORS?
```

⚠️ **Fehlt CORS, wird der Server NICHT selbst neu gestartet.** `lms server start` (auch
ohne Flags) schreibt die Server-Konfiguration dauerhaft nach
`~/.lmstudio/.internal/http-server-config.json` — samt `networkInterface`. Ein Neustart mit
dem CLI-Default bindet den Server auf `127.0.0.1` und sperrt damit **andere Rechner im Netz**
vom Inferenz-Server aus; lokal sieht danach alles grün aus, der Schaden entsteht woanders und
fällt hier nicht auf. Dieselbe Gattung wie ein Obsidian-Quit auf eine fremde Messreihe, nur
ohne Lock, der davor schützt. Wer CORS braucht, stimmt sich ab, statt zu starten — und wenn
C deshalb rot bleibt, ist das ein protokollierter roter Punkt mit Grund, keine Reparatur.

## Prüfpunkte

Stand des letzten Laufs: **2026-09-07, 23:5x CEST**, Obsidian **1.14.0**, Zweitinstanz auf
`:9341`, Vault `$STAGING_VAULTS_DIR/lingotuner`, Endpunkt LM Studio `127.0.0.1:1234`
(`qwen/qwen3.8-27b`, vom Treiber aus der Modellliste des Servers gewählt — siehe
„Modellwahl" unten).

| Id | Name | misst | Zustand | Datum |
|---|---|---|---|---|
| A1 | Plugin geladen | `app.plugins.plugins.lingotuner` — mit Restricted-Mode-Freischaltung, aber **nur** im eigenen Staging-Vault | grün | 2026-09-07 |
| A2 | Befehle registriert | `open-panel` und `tune-selection` in `app.commands.commands` | grün | 2026-09-07 |
| A3 | Panel öffnet | `open-panel` erzeugt ein Leaf mit `.lt-panel` | grün | 2026-09-07 |
| B1 | drei Quellen-Chips | `.lt-source-chip` × 3 (Markierung · Aktive Notiz · Textfeld) | grün | 2026-09-07 |
| B2 | vier Regler | `.lt-dial-input` × 4 (directness, context, social, semantics) | grün | 2026-09-07 |
| B3 | vier Preset-Chips | `.lt-preset-chip` × 4 (`BUILTIN_PRESETS`) | grün | 2026-09-07 |
| B4 | Notiz als Quelle erkannt | `.lt-source-line` ohne `is-blocked`, mit Zeichenzahl — die Naht Tracker→Panel | grün | 2026-09-07 |
| B5 | Noop sperrt Tunen | alle Regler 0 + keine Anmerkung → `.lt-run` disabled | grün | 2026-09-07 |
| B6 | Regler gibt Tunen frei | social auf +2 → `.lt-run` aktiv | grün | 2026-09-07 |
| B7 | Preset zeigt (angepasst) | `.lt-preset-custom` trägt **Text**, sobald die Regler kein Preset mehr treffen (der Span selbst steht immer da — siehe unten) | grün | 2026-09-07 |
| B8 | Textfeld-Quelle zeigt Textarea | Quelle „Textfeld" rendert `.lt-freetext` | grün | 2026-09-07 |
| B9 | Lesemodus blockiert die Quelle | Notiz auf `mode: preview` → `.lt-source-line.is-blocked` | grün | 2026-09-07 |
| B10 | Tippen ins Textfeld behält den Fokus | `execCommand("insertText")` in `.lt-freetext`; nach 500 ms trägt die Textarea `abc` UND ist noch `document.activeElement` | grün | 2026-09-07 |
| C1 | Stream liefert Ergebnis | `.lt-status.is-ok` und nichtleere `.lt-preview` nach einem echten Lauf | grün (2578 Zeichen) | 2026-09-07 |
| C2 | Kopieren freigegeben | `.lt-out-copy` nicht mehr disabled, sobald ein Ergebnis steht | grün | 2026-09-07 |
| C3 | Notiz ersetzen schreibt Body | Datei ändert sich, `---\ntype: draft\n---` steht weiter oben — Frontmatter überlebt | grün | 2026-09-07 |
| C4 | Neue Notiz entsteht | eine Datei mit `(tuned)`/`(getunt)` im Namen taucht auf | grün (`Mail-Entwurf (getunt).md`) | 2026-09-07 |
| C5 | `is-checking` animiert | `getComputedStyle(".lt-status-icon svg").animationName === "lt-spin"` **während** des Streams | grün | 2026-09-07 |
| C6 | Logbuch anlegen und anhängen | nach zwei Läufen: `LingoTuner/LingoTuner YYYY-MM.md` mit `type: lingotuner-log` und zwei `## `-Einträgen | grün (2 Einträge) | 2026-09-07 |
| C7 | Ersetzen-Ziel sperrt bei geänderter Quelle | Editor-Inhalt ändern → `.lt-out-replace-note` disabled (Guard „Quelle geändert") | grün | 2026-09-07 |
| C8 | Gedanken-Block während des Streams | eigener, absichtlich abgebrochener Lauf mit eingeschaltetem Denken: `.lt-reasoning` steht im DOM, **während** `.lt-status` auf `is-checking` steht | grün (9 Zeichen) | 2026-09-07 |
| C9 | kein Bedienelement wird verdeckt | Ausgabebereich künstlich gefüllt, dann je `.lt-run`/`.lt-refine`/`.lt-reset`/`.lt-out`: trifft `elementFromPoint` auf die Knopfmitte noch den Knopf? | grün (7 von 7, 8210 px in 208 px) | 2026-09-07 |

**Bilanz des letzten Laufs: 22 grün · 0 rot · 1 übersprungen.**

### B10, C8 und C9 — die Punkte aus den UI-Fehlern vom 2026-09-07

**B10** und **C9** sind die zwei Pflicht-Prüfpunkte aus dem Skill `gui-smoke-setup` § 3a
(„jede View mit Ausgabebereich"). Anlassfall dieser Regel war genau dieses Plugin; LingoTuner
ist ihr erster Konsument, deshalb steht hier die Standardform und keine dritte Variante.
**C8** kommt aus Fehler 3 und ist repo-eigen.

Beide decken einen gemeldeten Fehler ab, der vorher durch kein Netz fiel — und beide messen
eine **Naht**, keine Datenstruktur; im Unit-Test wäre keiner von beiden entscheidbar.

**B10** misst Fehler 1 („Textfeld lässt sich nicht beschreiben"). Ursache war ein Voll-Draw
des Panels auf `selectionchange`: jede Cursorbewegung IN der Textarea feuert dieses Ereignis,
`main.ts` gab es an `panel.refresh()` weiter, und `renderPanel` baute das Feld unter dem
Cursor neu. **Mutation und Wartephase sind getrennt** (`tippeInsTextfeld` / `messeFokus`):
im selben `evaluate` gemessen läge die Messung vor dem Redraw, denn der Debounce in
`main.ts` ist 150 ms. Die Mutation feuert den Auslöser selbst
(`document.dispatchEvent(new Event("selectionchange"))`).

⚠️ **Gepollt wird auf den NEGATIVEN Zustand, und das ist kein Stilfrage.** Ein `pollUntil`
auf „Fokus liegt im Feld" kehrt beim **ersten** Versuch zurück — also vor dem Debounce —
und wäre deshalb auch gegen die kaputte Fassung grün: dort fällt der Fokus erst nach
~150 ms weg. Gemessen wird deshalb ein **Fenster** von 1200 ms, in dem der Fokus nicht
wegfallen darf; erst danach der Endstand (`value === "abc"`). Beide Hälften zusammen: vor
dem Fix war das Zeichen da und der Fokus weg, ein einzelner der beiden Werte hätte den
Fehler verfehlt.

**C9** misst die zweite Hälfte von Fehler 2 — nicht „läuft Text über die Leiste", sondern
**„ist der Knopf noch klickbar"**. Geometrie taugt dafür nicht: ein Kind eines Containers mit
`overflow: auto` behält seine Box unterhalb der Kante und wird dort trotzdem abgeschnitten.
An genau dieser Stelle gemessen: die Boxen meldeten 2554 px Überstand, gemalt war nichts
davon. Der Punkt füllt den Ausgabebereich vorher künstlich auf und meldet die Vorbedingung
(`8210 px in 208 px`) im Detailtext mit — ohne Überlauf könnte er nicht rot werden
(CORE-TEST-01).

**C8** misst Fehler 3 („Denken wird nicht gestreamt"). Der Punkt fährt einen **eigenen,
absichtlich abgebrochenen** Lauf mit eingeschaltetem Denken. Der erste Entwurf hat die
Messung in den zweiten Lauf gefaltet, um Zeit zu sparen; das ist gemessen schiefgegangen und
steht hier, weil die Lehre allgemein ist: mit Denken überschritt derselbe Lauf die
120-s-Grenze von `laufeTune`, und C3/C4 klickten danach auf Knöpfe, die während eines
laufenden Streams gesperrt sind — **zwei rote und ein übersprungener Punkt als Preis einer
eingesparten Minute.** Liefert das gewählte Modell gar keinen Gedankenstrom, wird C8
**übersprungen mit genau diesem Grund**, nicht rot: das ist eine Modelleigenschaft, kein
Plugin-Defekt.

### Modellwahl: warum der Treiber sie seit dem 2026-09-07 selbst trifft

Das Fixture stellt „Server wählt das Modell" ein (`model: ""`). Das trägt nur, solange dort
**genau ein** Modell geladen ist. Am Abend des 2026-09-07 waren es neun, und LM Studio
antwortete mit `400` — auf `model: ""` mit „Invalid model identifier", auf ein **fehlendes**
Feld mit „Multiple models are loaded". Beide Nutzlast-Formen sind per `curl` gegengeprüft
worden, bevor am Plugin etwas geändert wurde: **es ist eine Eigenschaft des Endpunkts, kein
Plugin-Defekt** — ein „Fix" am Anfrage-Körper hätte hier nichts geheilt.

Der Treiber liest deshalb `/v1/models` und setzt die erste Id für die Dauer des Laufs
(zurückgestellt im `finally`). Ein Modellname im Repo käme nicht in Frage: das wäre die
Modell-Bibliothek eines bestimmten Rechners in einer getrackten Datei.

### B7 misst seit dem 2026-09-07 den Text statt der Existenz

`.lt-preset-custom` ist jetzt ein **fester Platzhalter** im DOM: ein Reglerzug muss ihn
umschalten können, ohne die Preset-Zeile neu zu bauen — sonst zöge er den gegriffenen Regler
unter dem Zeiger weg (dieselbe Ursache wie Fehler 1). Eine Zählung wäre seitdem immer `1`
und damit ein Prüfpunkt, der nichts mehr misst; gemessen wird der Text.

### C5, C6, C7 — warum diese drei zusätzlich

`view.ts` und `main.ts` haben keine Unit-Tests (Befund aus den Reviews zu Task 11/12). Die
drei Punkte decken genau die Naht, die dort unbelegt bleibt: die Statusanimation lebt in
`styles.css` und ist im DOM nur zur Laufzeit entscheidbar; das Logbuch schreibt aus
`main.tune()` heraus in den Vault; der Ersetzen-Guard entsteht erst aus dem Zusammenspiel
von `SelectionTracker`, `active-leaf-change` und `canReplaceNote`.

C5 wird **während** des Streams gemessen — danach steht `.lt-status` auf `is-ok` und die
Frage ist weg. Steht das System auf `prefers-reduced-motion: reduce`, schaltet `styles.css`
die Animation absichtlich ab; der Punkt wird dann **übersprungen mit genau diesem Grund**,
nicht rot (gemessen am 2026-09-07: reduce war aus).

## Bewusst übersprungene Punkte

| Punkt | Grund |
|---|---|
| Markierung ersetzen (Rand-Whitespace) | Eine Editor-**Selektion** ließe sich über CDP nur über CodeMirror-Interna setzen. Die Logik selbst ist im Unit-Test abgedeckt (`tests/editor-io.test.ts`, `splitSelectionAffix`); im Smoke bliebe Handarbeit. Eine stillschweigend ausgelassene Prüfung liest sich hinterher wie eine grüne — deshalb steht sie im Protokoll. |

## Gegenprobe (Pflicht: ein Werkzeug, das nie rot wird, misst nichts)

**2026-09-07, 18:44 CEST.** Gebrochen wurde eine Zeile in `src/obsidian/view-render.ts`:

```
- run.disabled = !ready || noop;
+ run.disabled = false;
```

Danach `npm run build`, Deploy in den Staging-Vault, Zweitinstanz per CDP `location.reload()`,
erneuter Lauf:

```
✗ B5 Noop sperrt Tunen — disabled=false
18 gruen · 1 rot · 1 uebersprungen
```

**Genau ein Punkt wurde rot, und zwar der richtige** — B4 und B6 blieben grün, weil sie
etwas anderes messen. Danach `git checkout -- src/obsidian/view-render.ts`, bauen,
deployen, reload, Lauf: **19 grün · 0 rot · 1 übersprungen.** Beide Richtungen belegt.

### Gegenprobe für die neuen Punkte B10 und C8 (2026-09-07, abends)

Ein neuer Prüfpunkt, der nie rot wird, misst nichts — beide sind deshalb gegen den
**Zustand vor ihrem Fix** gefahren worden, in zwei Läufen.

**Lauf A — nur die halbe Ursache gebrochen.** Gebrochen wurden `view.ts::refresh()` (zurück
auf den unbedingten Voll-Draw) und der Gedanken-Block in `run()::onReasoning` (früher
`return`, also nur sammeln statt zeichnen). Ergebnis: **20 grün · 1 rot**, rot war **nur C8**
— und **B10 blieb grün.**

⚠️ Das ist der lehrreiche Teil: **B10 misst das Zusammenspiel beider Hälften von Fix 1, und
in diesem Szenario trägt die Hälfte in `main.ts` allein.** Der `selectionchange`-Guard dort
verhindert, dass `refresh()` beim Tippen überhaupt gerufen wird; ob `refresh()` danach voll
zeichnen würde, wird beim Tippen also gar nicht sichtbar. Wer nur die `view.ts`-Hälfte
bricht und B10 grün sieht, schließt daraus fälschlich, der Punkt sei blind.

**Lauf B — beide Hälften gebrochen.** Zusätzlich die Zeile
`if (aktiv !== null && aktiv.closest(".lt-panel") !== null) return;` aus `main.ts` entfernt.
Ergebnis: **20 grün · 1 rot**, rot war **nur B10**:

```
✗ B10 Tippen ins Textfeld behaelt den Fokus — value="abc",
      activeElement="mod-macos is-frameless is-hidden-frameless obsidian-app them"
```

Das Zeichen kam an, der Fokus lag auf `<body>` — exakt der von Johannes gemeldete Zustand.
Danach beide Dateien zurück, bauen, deployen, reload: **21 grün · 0 rot · 1 übersprungen.**

Die `view.ts`-Hälfte ist damit **nicht** durch den Smoke belegt, sondern durch
`tests/view-soft.test.ts` (`structureKey`/`patchPanel`). Sie deckt die Wege ab, die B10
nicht anfasst: `active-leaf-change`, den gegriffenen Regler und die spät eintreffende
Modell-Liste.

**Nachgezogen auf die Skill-Form, Gegenprobe wiederholt.** Nachdem B10 auf die Form aus
`gui-smoke-setup` § 3a umgestellt war (Mutation/Wartephase getrennt, Auslöser selbst
gefeuert, Fenster-Poll), wurde derselbe Bruch erneut gefahren: **21 grün · 1 rot**, rot war
wieder **nur B10** — `value="abc", Fokus fiel auf "mod-macos is-frameless …"`. Die neue Form
misst also dasselbe wie die alte. Das war nicht selbstverständlich: mit einem `pollUntil` auf
die positive Bedingung wäre sie an dieser Stelle grün geblieben (siehe oben).

### Gegenprobe für C9 (2026-09-07, abends)

**Der stärkste Beleg ist ungeplant entstanden: C9 war beim ersten Lauf rot, und zwar zu
Recht.** Der Fix für Fehler 2 hatte die Ausführen-Zeile in den rollenden Bedienblock gelegt;
sobald ein Ergebnis stand, war sie herausgerollt, und ein Klick auf die Mitte von
„Nachschärfen" traf `view-content lt-panel`, einer auf „Zurücksetzen" ein `<p>` der Vorschau.
Die Knöpfe waren da und nicht erreichbar — genau die Fehlerart, für die der Punkt gedacht ist.
Behoben, indem `.lt-run-row` aus `.lt-controls` heraus in den festen Teil des Panels wanderte.
Danach grün. Beide Richtungen also an einem **echten** Defekt belegt, nicht an einem gestellten.

⚠️ **Die im Skill vorgeschlagene künstliche Gegenprobe funktioniert hier NICHT** — gemessen,
nicht vermutet. `.lt-preview` per `style.height = "3000px"` zu überhöhen ließ die tatsächliche
Höhe bei **90 px**: das Element ist `flex: 1 1 0`, und in einer Flex-Spalte gewinnt die
Flex-Basis gegen `height`. C9 blieb grün — was sich liest wie „der Punkt misst nichts",
tatsächlich aber heißt „die Gegenprobe hat nichts verändert". Wirksam ist erst:

```js
p.style.flex = "0 0 3000px"; p.style.overflow = "visible";
```

Damit stieg die Höhe auf 3000 px und C9 meldete **4 verdeckte Bedienelemente**
(`lt-out-replace-selection`, `lt-out-replace-note`, `lt-out-copy`, `lt-out-new-note`).
Danach `style.removeProperty(...)`, Höhe wieder 90 px. **Wer eine Gegenprobe fährt, prüft
zuerst, ob sie den Zustand überhaupt hergestellt hat** — sonst misst man die Gegenprobe
statt den Prüfpunkt.

## Läufe vom 2026-09-07 (Protokoll)

| # | Zeit | Stand | Ergebnis | Anmerkung |
|---|---|---|---|---|
| 1 | 18:29 | Repo-Stand, CORS aus | 11 grün · 3 rot (B4, B6, C1) · 6 übersprungen | siehe unten — beides Umgebung/Treiber, kein Plugin-Defekt |
| 2 | 18:38 | Repo-Stand, CORS an | 19 grün · 0 rot · 1 übersprungen | erster vollständiger Lauf |
| 3 | 18:44 | **B5 gebrochen** | 18 grün · 1 rot (B5) · 1 übersprungen | Gegenprobe |
| 4 | 18:49 | Repo-Stand zurück | 13 grün · 1 rot (C1) · 6 übersprungen | Stream riss ab (`ERR_INCOMPLETE_CHUNKED_ENCODING`), Endpunktseite |
| 5 | 18:54 | Repo-Stand | 13 grün · 1 rot (C1) · 6 übersprungen | CORS war am Endpunkt wieder aus |
| 6 | 18:58 | Repo-Stand, CORS an | 19 grün · 0 rot · 1 übersprungen | Rückweg der Gegenprobe geschlossen |
| 7 | 19:07 | Repo-Stand, **Treiber im Commit-Stand** | **19 grün · 0 rot · 1 übersprungen** | maßgeblicher Lauf — nach Lauf 6 wurden zwei Listen im Treiber zusammengelegt; ein Lauf danach ist der einzige, der die committete Fassung belegt |
| 8 | 23:33 | UI-Fixes, erster Lauf | 14 grün · 1 rot (C1) · 7 übersprungen | LM Studio wies `model: ""` mit 400 ab — neun Modelle geladen, Endpunktzustand, kein Plugin-Defekt (per `curl` gegengeprüft) |
| 9 | 23:41 | Treiber wählt das Modell selbst | 18 grün · 2 rot (C3, C4) · 2 übersprungen | C8 war in Lauf 2 gefaltet; mit Denken riss der die 120-s-Grenze, C3/C4 klickten in einen laufenden Stream |
| 10 | 23:48 | C8 als eigener, abgebrochener Lauf | **21 grün · 0 rot · 1 übersprungen** | erster vollständiger Lauf mit den Fixes |
| 11 | 23:52 | **`refresh()` + Gedanken-Block gebrochen** | 20 grün · 1 rot (C8) · 1 übersprungen | Gegenprobe A — B10 blieb grün (siehe oben) |
| 12 | 23:57 | **beide Hälften von Fix 1 gebrochen** | 20 grün · 1 rot (B10) · 1 übersprungen | Gegenprobe B |
| 13 | 00:0x | Repo-Stand zurück | 21 grün · 0 rot · 1 übersprungen | vor der Angleichung an `gui-smoke-setup` § 3a |
| 14 | 00:0x | B10 in Skill-Form, C9 neu | 21 grün · **1 rot (C9)** · 1 übersprungen | C9 fand einen echten Defekt: die Ausführen-Zeile war aus dem rollenden Block herausgerollt |
| 15 | 00:1x | `.lt-run-row` in den festen Teil | 22 grün · 0 rot · 1 übersprungen | C9 grün |
| 16 | 00:1x | **beide Hälften von Fix 1 gebrochen** | 21 grün · 1 rot (B10) · 1 übersprungen | Gegenprobe für die neue B10-Form |
| 17 | 00:2x | Repo-Stand, Vorschau-Boden statt Deckel | **22 grün · 0 rot · 1 übersprungen** | maßgeblicher Lauf |

### Was Lauf 1 gelehrt hat

**B4/B6 rot, ohne Plugin-Defekt.** Der erste Klick auf einen Quellen-Chip ging ins Leere:
`clickReal` misst die Bildschirmkoordinate **vor** dem Klick, und die rechte Sidebar bewegt
sich zu diesem Zeitpunkt noch (`revealLeaf` animiert). Die Quelle blieb auf „Markierung",
die Bereitschaftszeile blieb blockiert — und das liest sich als Plugin-Defekt. Aus
gesetztem Layout unmittelbar danach: grün. Der Treiber wiederholt seitdem die **Mutation**
(`waehleQuelle`, bis zu drei Klicks, mit Beleg im Detailtext), nicht die Aussage: bleibt der
Chip auch nach drei Klicks inaktiv, ist das ein Befund und wird als solcher gemeldet. Der
Zusatz „(Chip erst im 2. Anlauf aktiv)" tauchte in Lauf 4 und 5 tatsächlich auf — die
Härtung hat also nicht bloß einen Einzelfall zugedeckt.

**C1 rot wegen CORS.** Der Endpunkt war erreichbar (`GET /v1/models` → 200), der Preflight
auf `POST /v1/chat/completions` aber nicht. Das Plugin hat das **richtig** diagnostiziert
und den Weg genannt. `endpointReachable()` im Treiber prüft nur `/v1/models` und kann diesen
Fall deshalb nicht vorab als „übersprungen" führen — er landet als roter C1 mit der
sprechenden Statusmeldung, was die zweitbeste Auflösung ist.

**Nebenbefund, der den Treiber verändert hat:** `lastDials` wird bei jeder Reglerbewegung
nach `data.json` geschrieben und überlebt den Lauf. B5 („alle Regler 0 sperren Tunen") misst
beim **zweiten** Lauf sonst den Rest des ersten und ist rot, ohne dass sich am Plugin etwas
geändert hätte. Der Treiber stellt den Ausgangszustand deshalb selbst her
(`setzeAusgangszustand`: Layout leer, Regler neutral) und schreibt den Vorwert im `finally`
zurück — der Lauf behält nichts vom Wirt.
