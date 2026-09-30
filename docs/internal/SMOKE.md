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
  --intent "GUI-Smoke Zweitinstanz :9341" --exclusive focus --ttl 1800
# 1800 statt 300: Teil C fährt zwei echte LLM-Läufe (C8 mit Denken); mit 900 lief der Lock
# am 2026-09-08 mitten im Lauf ab. Ein Lauf ohne erreichbaren Endpunkt (Teil C übersprungen) braucht 300.
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

Stand des letzten Laufs: **2026-09-11, 10:1x CEST** (Fix-Runde 1 nach der Review), Obsidian **1.14.0**, Zweitinstanz auf
`:9341`, Vault `$STAGING_VAULTS_DIR/lingotuner`, Endpunkt LM Studio `127.0.0.1:1234`
(`qwen/qwen3.6-27b`, vom Treiber aus der Modellliste des Servers gewählt — siehe
„Modellwahl" unten). An dem Tag ist der Antwortbereich auf `obsidian-kit` 0.34.0
(`buildStreamArea`/`createStableWriter`) umgestellt worden und das Panel zu **einem**
Rollbereich geworden; C9/C9b tragen seitdem eine andere Frage, C11/C11b/C9c sind neu.

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
| B10 | Tippen ins Textfeld behält den Fokus | `execCommand("insertText")` in `.lt-freetext`, dann `selectionchange` gefeuert; der Fokus darf **1200 ms lang nicht wegfallen** (Poll auf den negativen Zustand), danach trägt die Textarea `abc` | grün | 2026-09-08 |
| B11 | Tippen überlebt das Ende eines Laufs | **während** des Streams in `.lt-note` tippen; nach dem Schluss-`draw()` liegt der Fokus noch dort und der Text steht | grün | 2026-09-08 |
| C1 | Stream liefert Ergebnis | `.lt-status.is-ok` und nichtleere `.lt-preview` nach einem echten Lauf | grün (49 Zeichen) | 2026-09-11 |
| C2 | Kopieren freigegeben | `.lt-out-copy` nicht mehr disabled, sobald ein Ergebnis steht | grün | 2026-09-07 |
| C3 | Notiz ersetzen schreibt Body | Datei ändert sich, `---\ntype: draft\n---` steht weiter oben — Frontmatter überlebt | grün | 2026-09-07 |
| C4 | Neue Notiz entsteht | eine Datei mit `(tuned)`/`(getunt)` im Namen taucht auf | grün (`Mail-Entwurf (getunt).md`) | 2026-09-07 |
| C5 | `is-checking` animiert | `getComputedStyle(".lt-status-icon svg").animationName === "lt-spin"` **während** des Streams | grün | 2026-09-07 |
| C6 | Logbuch anlegen und anhängen | nach zwei Läufen: `LingoTuner/LingoTuner YYYY-MM.md` mit `type: lingotuner-log` und zwei `## `-Einträgen | grün (2 Einträge) | 2026-09-07 |
| C7 | Ersetzen-Ziel sperrt bei geänderter Quelle | Editor-Inhalt ändern → `.lt-out-replace-note` disabled (Guard „Quelle geändert") | grün | 2026-09-07 |
| C8 | Gedanken-Block während des Streams | eigener, absichtlich abgebrochener Lauf mit eingeschaltetem Denken: `.okit-stream-reasoning` steht im DOM, **während** `.lt-status` auf `is-checking` steht | grün (8 Zeichen) | 2026-09-11 |
| C9 | jedes Bedienelement ist erreichbar (natürliche Höhe) | Panel künstlich gefüllt, dann je `.lt-run`/`.lt-refine`/`.lt-reset`/`.lt-out`/`.lt-freetext`/erster `.lt-dial-input`: `scrollIntoView`, danach trifft `elementFromPoint` auf die Mitte noch das Element? Ohne Fläche = unerreichbar | grün (8 von 8, Panel 6629 px in 760 px) | 2026-09-11 |
| C9b | dasselbe auf einem **kurzen Panel** | Leaf-Höhe auf 420 px gedrückt, danach zurückgesetzt — deckt den geteilten rechten Seitenbereich ab | grün (8 von 8, Panel 6629 px in 420 px) | 2026-09-11 |
| C9c | Gegenprobe zu C9/C9b | `.lt-panel` bekommt `overflow: hidden` — dann **muss** mindestens ein Element unerreichbar werden, sonst misst die Probe nichts; **dieselbe Menge** wie C9, nur ohne Scrollen | grün (6 von 8 unerreichbar) | 2026-09-11 |
| C9d | Quell-Textfeld und Regler erreichbar | eigener Punkt am Ende von Teil C: Quelle auf „Textfeld", füllen, `.lt-freetext` + erster `.lt-dial-input` messen, Quelle im `finally` zurück — C9/C9b laufen bei Quelle „Notiz" und berühren das Feld nie | grün (2 von 2, Panel 6803 px in 760 px) | 2026-09-11 |
| C10 | Zurücksetzen fragt nach und räumt | mit Runden: Klick auf `.lt-reset` öffnet den Bestätigungsdialog; nach dem Bestätigen 0 Runden, kein `.lt-reset`, Leerzustand da | grün (vorher 2 Runden) | 2026-09-11 |
| C11 | Panel folgt dem Strom | alle 150 ms während des Laufs: steht der untere Rand von `.okit-stream-tail` noch im Sichtfenster des Panels, und wie groß ist `rest` (`scrollHeight − scrollTop − clientHeight`)? | grün (2/2 sichtbar, rest 0 px) | 2026-09-11 |
| C11b | Hochscrollen im Strom wird respektiert | mitten im Strom künstlich `scrollTop = 0`; danach darf das Kit **nicht** mehr nachziehen | grün (3 Messungen, größter Stand 0 px) | 2026-09-11 |
| S1 | Fake-Manager liefert den Apple-Endpunkt nur bei Opt-in | `list({capability})` ohne, `list({…, transports:["http","shortcuts"]})` mit Apple — misst den Fake selbst, damit S2 nicht grün wird, ohne dass das Opt-in je gebraucht wurde | grün | 2026-10-01 |
| S2 | Dropdown zeigt „Apple Intelligence (on-device)“ | Optionen der Endpunkt-Auswahl im Settings-Tab (`transports`-Option des Kit-Bausteins) | grün | 2026-10-01 |
| S3 | Wahl → Quelle traegt `transport: "shortcuts"` | Dropdown wie ein Nutzer setzen (`change`), dann `isShortcutsEndpoint()`; der Hinweis zu den Grenzen („4096“) steht im Tab | grün | 2026-10-01 |
| S4 | Lauf öffnet die `shortcuts://`-URL mit dem gefalteten Prompt | `window.open` **vor** dem Klick gestubbt (sonst öffnet die Zweitinstanz die Kurzbefehle-App), im `finally` zurückgebaut; URL beginnt mit `shortcuts://`, trägt den Namen und den Prompt | grün | 2026-10-01 |
| S5 | Zeitüberschreitung zeigt die Kurzbefehl-Meldung | Kurzbefehl-Frist 3 s, kein Callback: Status `is-error`, Text nennt „Apple Intelligence“, kein „(408)“ | grün | 2026-10-01 |

**Bilanz des letzten Laufs: 29 grün · 0 rot · 1 übersprungen — von 30 Prüfpunkten.**
(Vorlauf 2026-09-08, vor dem Kit-Umbau: 25 grün · 0 rot · 1 übersprungen von 26.)

⚠️ **Der Messtakt von C11/C11b stand auf 300 ms und war damit zu grob.** Die Antwort auf die
Fixture-Notiz ist nach etwa einer halben Sekunde fertig; C11b fiel deshalb in zwei Läufen
hintereinander als „nicht messbar" aus — ein Punkt, der bei kurzen Antworten regelmäßig
verschwindet, misst im Alltag nichts. 150 ms und Störung nach der zweiten Messung: grün. Der
Takt bestimmt die Auflösung, nicht die Aussage.

### C9 hat seit dem 2026-09-11 eine andere Frage

Bis dahin lautete sie **„wird etwas verdeckt?"** — das Panel teilte seine feste Höhe auf, nur
die Vorschau rollte, und ein Knopf konnte unter einem überlaufenden Bereich verschwinden oder
bei `overflow: hidden` ersatzlos abgeschnitten werden. Seit das Panel **ein** Rollbereich ist,
gibt es beides nicht mehr; dafür steht regelmäßig etwas außerhalb des Sichtfensters. „Nicht
sichtbar" ist damit kein Fehler mehr, **„nicht erreichbar"** schon. Gemessen wird deshalb mit
`scrollIntoView` davor — und geprüft werden nicht nur Knöpfe, sondern auch das Quell-Textfeld
und der erste Regler: die waren es, die in der alten Aufteilung bei 420 px unerreichbar wurden.

`.lt-freetext` gibt es nur bei der Quelle „Textfeld"; steht die Quelle anders, meldet der
Detailtext das ausdrücklich mit (`nicht im Panel: .lt-freetext`) statt es zu verschweigen.

**C9c misst seit der Fix-Runde vom 2026-09-11 dieselbe MENGE wie C9** (`erreichbarAusdruck`
mit einem Parameter `scrollen`, eine Liste `BEDIENELEMENTE` für beide). Vorher fuhr die
Gegenprobe einen eigenen, inline duplizierten Loop, der `.lt-freetext` nicht kannte und alle
vier Regler nahm — also genau der Drift, den sie verhindern sollte; und ihr Nenner zählte jedes
Element mit Fläche doppelt („6 von 17" statt „6 von 8").

⚠️ **C9c benutzt bewusst KEIN `scrollIntoView`**, anders als C9/C9b. Sachlich: ohne
Rollbereich gibt es nichts hinzuscrollen. Gemessen: mit `scrollIntoView` bei `overflow: hidden`
sucht Chromium den nächsten rollbaren Vorfahren, Obsidian antwortet mit einem Layout-Sturm, und
der erste Lauf am 2026-09-11 starb an „Zeitüberschreitung: Runtime.evaluate" (30 s) — **mitsamt
allen danach ungemessenen Punkten.** Die Probe fängt ihre eigene Zeitüberschreitung jetzt ab
und meldet sie als roten Punkt, statt den Lauf zu reißen.

### C11/C11b — die Folge-Schwelle, seit das Panel rollt

Das Kit scrollt dem Strom nach (`followTail`), aber nur, wenn der Leser ohnehin unten steht
(Schwelle `followThreshold`, Default 40 px). Diese Schwelle misst den Abstand zur **Scroll-Kante**
— und unter dem Antwortbereich stehen jetzt noch Verlauf und Ausgangsknöpfe. Der Verdacht war,
dass deren Höhe die Schwelle überschreitet und das Folgen deshalb ausbleibt.

**Gemessen ist er widerlegt:** unter dem Stream-Bereich lagen 188 px, `rest` war in jeder
Messung **0 px**, der laufende Absatz in 3 von 3 Messungen sichtbar. Der Grund ist die Bauart
von `followTail`: es scrollt bis `scrollTop = scrollHeight` — die 188 px sind danach mit im
Sichtfenster, `rest` fällt auf 0 und bleibt dort. Die 40-px-Schwelle wird nie zum Thema,
solange der Nutzer nicht eingreift. **C11b** misst die andere Hälfte: nach künstlichem
`scrollTop = 0` blieb der Stand in 7 Folgemessungen bei 0 px — die Hand des Nutzers gewinnt.

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
*(die folgende Beschreibung gilt für den Stand bis 2026-09-11; seit dem Ein-Rollbereich-Panel
lautet die Frage „ist es erreichbar?" — siehe „C9 hat seit dem 2026-09-11 eine andere Frage")*
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

### B11, C9b und C10 — die Punkte aus der Review vom 2026-09-08

**B11** ist B10s Zwilling in einem schmaleren Fenster. Die Anmerkung ist während eines Streams
absichtlich **nicht** gesperrt — der Nutzer tippt dort die nächste Runde, während er auf das
Ergebnis wartet. `run()` schließt mit einem bedingungslosen `draw()` ab, und das ersetzte bis
zum 2026-09-08 das Feld unter dem Cursor: derselbe Fehler wie Nr. 1, aber einmal je Lauf statt
bei jedem Tastendruck — und in dem Moment, in dem niemand hinsieht. Die Nummer folgt dem
Fehlerbild, der Ort der Abhängigkeit: gemessen wird im C-Teil, weil es ohne echten Lauf kein
Ende eines Laufs gibt.

**C9b** ist dieselbe Funktion wie C9 auf einem **kurzen Panel** (Leaf-Höhe 420 px, danach
zurückgesetzt). Eine einzelne Panelhöhe misst nur den Rechner, auf dem sie lief; ein geteilter
rechter Seitenbereich mit zwei gestapelten Panels ist der Normalfall. Der Punkt hat sich sofort
bezahlt gemacht — siehe die Gegenprobe unten.

**C10** deckt die Rückfrage vor dem Zurücksetzen. Der Knopf sitzt unmittelbar neben
„Nachschärfen", das man in einer Iterationsschleife oft klickt; ohne Rückfrage kostete ein
Fehlgriff die ganze Runden-Kette samt eines noch nicht kopierten Ergebnisses, ohne Undo.
Gemessen wird beides: dass der Dialog kommt **und** dass danach wirklich geräumt ist.

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

### L1 — llm-lab bekommt Aufzeichnungen (seit 2026-09-25)

Der Punkt, den der Treiber bis dahin nicht hatte: `readLabApi` gab bei einer Versionsabweichung **still** `null` zurück, und `llm-lab` (apiVersion 4) bekam von LingoTuner (Client prüfte 3) nichts — ohne Fehler, ohne rotes Zeichen. Gemessen wird deshalb die **Wirkung** gegen das **echte** `llm-lab` (kein Stub, dessen Version mit dem Client altern könnte): eine neue Zeile mit `plugin: "lingotuner"` in `.obsidian/plugins/llm-lab/traces/*.jsonl`, mit gesetzter `turnId`.

- `npm run smoke:gui -- --setup` deployt `../llm-lab` (`main.js`, `manifest.json`, `styles.css`; vorher dort bauen) in den Staging-Vault und trägt es in `community-plugins.json` ein. Die Zweitinstanz danach **neu starten** (Plugin-Code wird nur beim Start geladen).
- Ohne geladenes `llm-lab` steht der Punkt **übersprungen** mit Grund da — nie still grün.
- Der Lauf geht gegen den Fake-Manager-Endpunkt (wie M2), braucht also kein Modell in LM Studio.
- Gegenprobe (2026-09-25): mit dem Client-Stand von 0.3.1 (`SUPPORTED_API_VERSION = 3`) ist L1 rot (`Zeilen von lingotuner 0 → 0`), mit 4 grün (`4 → 5`, `turnId` gesetzt).

### F1 — Origin-Weigerung: Anfrage ohne Stream (seit 2026-09-26)

Der Chat-Client aus Kit 0.43.0 wiederholt nach einer Origin-/CORS-Weigerung des XHR-Streams einmal ohne Stream über `requestUrl`. Der Fake-Server sendet **keine** CORS-Header: der Preflight aus `app://obsidian.md` scheitert, `requestUrl` (Hauptprozess, ohne Origin) kommt durch. Gemessen wird die Wirkung: der Lauf liefert ein Ergebnis (`fallback ok`), der Server sah genau einen POST, und dessen Body trägt `stream: false`.

- Der Renderer meldet dabei zwei erwartete Fehlerzeilen (CORS-Preflight, `net::ERR_FAILED`); sie stehen als `WARNUNG` in der Bilanz und sind hier die Ursache, kein Befund.
- Gegenprobe (2026-09-26): mit CORS-Headern am Fake-Server ist F1 rot (`stream im Body: true`), ohne sie grün.

## Bewusst übersprungene Punkte

| Punkt | Grund |
|---|---|
| Markierung ersetzen (Rand-Whitespace) | Eine Editor-**Selektion** ließe sich über CDP nur über CodeMirror-Interna setzen. Die Logik selbst ist im Unit-Test abgedeckt (`tests/editor-io.test.ts`, `splitSelectionAffix`); im Smoke bliebe Handarbeit. Eine stillschweigend ausgelassene Prüfung liest sich hinterher wie eine grüne — deshalb steht sie im Protokoll. |

## Gegenprobe (Pflicht: ein Werkzeug, das nie rot wird, misst nichts)

**S1–S5 (2026-10-01):** ohne die Option `transports: ["http", "shortcuts"]` im Settings-Tab sind S2–S5 **rot** (Dropdown ohne Apple, Quelle bleibt HTTP, `window.open` nie aufgerufen, Status nicht `is-error`), S1 bleibt grün — die Punkte hängen an der Option, nicht am Fake. Ein echter Rundlauf (die Kurzbefehle-App antwortet) ist nur am Gerät möglich und bewusst kein Prüfpunkt: die Protokoll-Rückkehr `obsidian://lingotuner-shortcut` lässt sich im Renderer nicht auslösen (`app.protocolHandlers` fehlt).


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

### Gegenproben für B11, C9b und C10 (2026-09-08)

**C9b brauchte keine gestellte Gegenprobe — er war beim ersten Lauf rot, und der Befund war
echt.** Die Review hatte ihn aus dem CSS *abgeleitet* und ausdrücklich als ungemessen markiert:
`min-height` ist für Flexbox eine harte Untergrenze, außer `.lt-controls` schrumpft nichts, und
bei `overflow: hidden` wird ein Überstand ersatzlos abgeschnitten. Gemessen bei 420 px:

```
✗ C9b — lt-out lt-out-copy → workspace-tab-container · lt-out lt-out-new-note → workspace-tab-container
```

„Kopieren" und „Neue Notiz" hatten **keine Fläche mehr**. Nach `min-height: min(14em, 40%)`:
7 von 7 klickbar, Vorschau 148 px statt 208 px. Bei 760 px ändert sich nichts (40 % ≈ 290 px
> 208 px) — die natürliche Lage ist in beiden Läufen identisch grün.

**B11 und C10** gegen ihren Vor-Zustand gefahren (Wiederherstellung auskommentiert,
Rückfrage-Zweig übersprungen): **23 grün · 2 rot**, rot waren genau die beiden:

```
✗ B11 — value="abc", Fokus fiel auf "mod-macos is-frameless is-hidden-frameless is-focused obsidi"
✗ C10 — kein Bestaetigungsdialog nach dem Klick — 2 Runden waeren ungefragt weg gewesen
```

Danach zurück: **25 grün · 0 rot · 1 übersprungen.**

ⓘ **Was C9b zusätzlich sichtbar gemacht hat und was er NICHT prüft.** Bei 420 px ist
`.lt-controls` auf **0 px** zusammengefaltet — Quellen, Presets, Regler und Anmerkung sind dann
unsichtbar und mangels Höhe auch nicht scrollbar. Über die Panelhöhe gemessen (Vorschau in
Klammern): 420 → 0 px (150), 470 → 10 (170), 520 → 40 (190), 570 → 70 (210), 620 → 120 (210),
760 → 260 (210). **Verdeckt war bei keiner Höhe etwas** — C9/C9b bleiben also zu Recht grün, sie
messen Erreichbarkeit, nicht Nutzbarkeit. Der Platz geht an die Ausführen-Zeile, die schmal
umgebrochen 132 px belegt und per Vertrag nicht schrumpfen darf. Ein Boden auf `.lt-controls`
wäre die naheliegende Antwort und genau der Fehler, den C9b eben gefunden hat: die Summe der
Untergrenzen überschritte die Panelhöhe wieder, und dann würde erneut abgeschnitten. Offen als
Design-Frage, nicht als Defekt.

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
| 17 | 00:2x | Repo-Stand, Vorschau-Boden statt Deckel | 22 grün · 0 rot · 1 übersprungen | letzter Lauf der ersten Welle |
| 18 | 00:5x | Fix-Runde 2, **vor** dem C-1-Fix | 24 grün · **1 rot (C9b)** · 1 übersprungen | C9b bestätigt den aus dem CSS abgeleiteten Befund: zwei Ausgangsknöpfe ohne Fläche |
| 19 | 01:0x | `min-height: min(14em, 40%)` | 25 grün · 0 rot · 1 übersprungen | beide Lagen grün |
| 20 | 01:1x | **Wiederherstellung + Rückfrage gebrochen** | 23 grün · 2 rot (B11, C10) · 1 übersprungen | Gegenprobe |
| 21 | 01:2x | Repo-Stand zurück | **25 grün · 0 rot · 1 übersprungen** | maßgeblicher Lauf |
| 22 | 2026-09-11 09:1x | Kit-Umbau, erster Lauf | 21 grün · 0 rot · 0 übersprungen, dann **ABBRUCH** | C9c riss den Lauf: `scrollIntoView` bei `overflow: hidden` → „Zeitüberschreitung: Runtime.evaluate"; alles ab C7 ungemessen |
| 23 | 2026-09-11 09:2x | C9c ohne `scrollIntoView`, mit eigenem try/catch | **28 grün · 0 rot · 1 übersprungen** | maßgeblicher Lauf nach dem Kit-Umbau; C11/C11b neu und grün |
| 24 | 2026-09-11 09:5x | Fix-Runde 1 (I1, I3, M2, M9), C9d neu | 28 grün · 0 rot · **2 übersprungen** von 30 | C11b fiel aus: Antwort nach 3 Messungen à 300 ms fertig, die Störung kam nie |
| 25 | 2026-09-11 10:0x | Störung schon nach 2 Messungen | 28 grün · 0 rot · 2 übersprungen | reichte nicht — der Lauf war nach 2 Messungen vorbei |
| 26 | 2026-09-11 10:1x | Messtakt 300 → 150 ms | **29 grün · 0 rot · 1 übersprungen** von 30 | maßgeblicher Lauf der Fix-Runde; C11b grün |

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

## R1 — Runden-Zeile bei ~300 px (Welle 9, 2026-09-26)

Ein echter Lauf gegen einen Fake-Server, zwei Runden, die zweite mit langer Anmerkung, Sidebar auf 300 px: jede `.lt-history-row` muss `scrollWidth <= clientWidth` haben. Anlass: die aktive Zeile (fett, Herkunft plus Anmerkung) wurde links abgeschnitten, weil ein `button` seinen Text auf einer Zeile hält und Überlauf zentriert. Gegenprobe am alten Stand (`styles.css` aus `98df558`): rot, „2 von 6 Zeilen laufen über: 297 > 276, 452 > 276"; mit der Regel `white-space: normal` grün, 39 grün / 0 rot / 2 übersprungen von 41.
