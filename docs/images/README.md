# Aufnahme-Vertrag — README-Bilder

Skill `readme-shots` (global). Treiber `scripts/shots.ts`, Brücke importiert aus `../../tools/obsidian-cdp/` (Dach, nicht vendored). Fixture unter `docs/images/fixture/` (englisch, generisch, nur LingoTuner aktiv). Es ist **nicht** das Fixture des GUI-Smokes (`fixtures/vault/`): beide bauen ihren Vault nach `$STAGING_VAULTS_DIR`, der Aufnahme-Vault heißt `lingotuner-shots`, damit sie einander nicht überschreiben.

## Vorbedingungen, die dieser Vertrag NICHT selbst herstellt

1. **Aufnahme in einer Zweitinstanz** (eigenes `--user-data-dir`, eigener Port, Lock für diesen Port) — Freigabe Johannes, Welle 9. Die reguläre Instanz auf Port 9222 wird nicht angefasst. Profil: die aktuelle `.asar` aus dem regulären Profil hineinkopieren, Vault in `obsidian.json` eintragen.
2. **Obsidians Oberfläche läuft auf Englisch:** `language` in `obsidian.json` und `localStorage["language"]` auf `en`, danach Neustart. Der Treiber prüft das vor dem ersten Bild und bricht sonst mit Klartext ab.
3. **Der aktuelle Build ist im Aufnahme-Vault:** `npm run build && npm run shots -- --setup` legt ihn dort ab; der Treiber schaltet das Plugin bei Bedarf frei (Restricted Mode).
4. **Ein Motiv pro Lauf** (`--only <name>`). Ein Mehrmotiv-Lauf hat einmal eine leere Notiz „Untitled" im Vault angelegt (vermutlich ein Klick, der nach einer Layout-Änderung neben das Ziel fiel); der Treiber räumt sie inzwischen weg, die Einzelläufe sind trotzdem der belegte Weg.

## Das Modell ist eine Attrappe

Der Treiber startet auf Port 1236 den zentralen LLM-Stub (`tools/obsidian-cdp/llm-stub.ts`), der einen festen, redaktionell gewählten Text streamt (Modellname `qwen3.8-27b`, ein Name mit erkannter Familie, damit die Modellzeile die Denkstufe zeigt wie bei einem echten Modell). Die Bilder zeigen dadurch immer dasselbe Ergebnis, unabhängig davon, was auf dem Rechner geladen ist; der echte LM-Studio-Port 1234 bleibt unberührt. Endpunkt und Modell setzt der Treiber selbst und stellt sie am Ende zurück (`http://127.0.0.1:1234`, Modell leer, Regler neutral).

## Bildvertrag

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `hero.png` | hero | README.md, README.de.md (Kopf) | Das ganze Fenster: Notiz „Draft reply to Sam" im Editor, rechts das LingoTuner-Panel auf dem Kit-Rahmen: Ziel „Selection in Draft reply to Sam“ mit „New“, die Modellzeile (Modellname, Gehirn-Symbol, Denkstufe „○“, Neu laden), „Tune again from source“, Quelle „Selection: 175 characters in Draft reply to Sam“, Preset „Maximum clarity" aktiv, vier Regler am linken Anschlag mit ihren Stufennamen, leere Anmerkung, „Tune“, Status „Done“, „Preview of round 1“ mit Kopierknopf und dem gerenderten Ergebnis, darunter die Wege „Replace selection“, „New note“, „Discard“ |
| `rounds.png` | feature | README.md, README.de.md (Usage) | Dasselbe Fenster nach zwei Runden, das Panel ans Ende gerollt (es ist höher als das Fenster, und die feste Fußzeile deckte sonst die Liste ab): Regler, „Tune“, „Done“, „Preview of round 2“ mit dem nachgeschärften Ergebnis und die Liste „Rounds" mit „Round 1 · no note“ (from source) und der aktiven „Round 2 · Keep the …“ (refined from round 1), darunter die Wege. Aufgenommen in der Standardbreite der Seitenleiste (300 px) |
| `settings.png` | feature | README.md, README.de.md (Configuration) | Den Einstellungen-Tab von „Connection" bis zum Ende der Zeile „System prompt“: Endpunkt-Zeile mit grünem Haken und „active — this one is used", aufklappbares „Request" (zugeklappt), dann „Style“ mit „System prompt“ (Beschreibung, der ausgelieferte Prompt als Platzhalter im Feld, „Edit shipped prompt“, Kopieren, Zurücksetzen). Der Rest von „Style“ und die Gruppe „Output" fehlen bewusst: der Tab ist länger als das Fenster, und ein Ausschnitt darüber hinaus malt Schwarz |
| `dials.png` | detail | README.md, README.de.md (Usage) | Nur das Panel vom Ziel bis zum Knopf „Tune“, vor dem ersten Lauf: Preset „Collegial" aktiv, die vier Regler auf verschiedenen Stufen mit ihren Stufennamen („somewhat more direct", „unchanged“, „somewhat warmer", „unchanged“), leere Anmerkung, die Modellzeile mit Modellname und Denkstufe „○“ |

Kein GIF: der Stream ist das einzige bewegte Ereignis, und ein Standbild des Ergebnisses trägt die Aussage.

## Beispieldaten

Alles generisch und englisch: ein Mail-Entwurf an „Sam" (`docs/images/fixture/notes/Draft reply to Sam.md`) und zwei Nebennotizen für den Datei-Explorer. Keine echten Personen, Firmen oder Adressen.

## Reproduktionsrezept

```bash
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label lingotuner --intent "shots.ts --only hero" --exclusive focus --port <port> --ttl 300
npm run build && npm run shots -- --setup           # Vault lingotuner-shots aus dem Fixture
# Zweitinstanz mit Vault + englischer Oberfläche auf <port> starten, dann je Motiv:
npm run shots -- --port <port> --only hero          # hero | rounds | dials | settings
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
npm run shots:check                                 # readme_lint, muss „keine Befunde" melden
```

## Status

Hero, Rounds und Dials neu aufgenommen am 2026-11-25 abends (Welle 38, obsidian-kit 0.113.0 / code-kit 0.93.0: Quelle als Segment-Schalter, Titel „Style interpreter“), alle vier Motive in einem Lauf über `messlauf.sh` auf Port 9783, jedes Bild selbst angesehen; Settings blieb bytegleich. Vorher: alle vier Bilder neu aufgenommen am 2026-11-25 (Nachlauf Welle 37, Kit-Rahmen, obsidian-kit 0.111.0), Zweitinstanz auf Port 9820 über `messlauf.sh` (`RUNNER=shots`, `VAULT=lingotuner-shots`, `SETUP_BEFEHL="npm run shots -- --setup"`, je Motiv ein Lauf mit eigenem Lock), Obsidian 1.15.1, jedes Bild selbst angesehen. Das Fenster bekommt auf diesem Bildschirm 1200 × 949 statt 1200 × 1000.

- Erster Hero zeigte das `aria-label` „Note“ als Tooltip über dem Panel (der Zeiger ruhte nach dem Klick auf „Tune“): `mausWeg` nimmt den Zeiger vor jeder Aufnahme aus dem Bild.
- Prüfbilder (kein README-Bild): `npm run shots -- --port <p> --only pruef --bilder <ordner>` nimmt das Panel hell und dunkel bei 300 und 366 px auf, vor dem ersten Lauf und nach zwei Runden, oben und ans Ende gerollt. Sie fanden den Knopftext „Refine this result“ vor der ersten Runde und den Preset-Klick ohne Neuzeichnen (beides behoben, Smoke B5b und B6b). Derselbe Lauf schreibt `tastaturweg.txt`: echte Tab-Taste vom Knopf „New“ bis aus dem Panel heraus; am 2026-11-25 folgten die 28 Schritte den Stationen, mit zwei leeren, namenlosen Fokus-Stopps in der Fußzeile (Rahmen-CSS, Task im Cockpit obsidian-kit).

- Die Zeile der aktiven Runde lief bei 300 px einmal links über (2026-09-26); seither bricht sie um (Smoke R1), im Kit-Rahmen kürzt sie mit Auslassungspunkten.
- Der Fake-Server-Port 1236 muss frei sein; der Treiber meldet es, wenn nicht.
- Im Mehrmotiv-Lauf fing der Rückfrage-Dialog beim Schließen mit offener Runde (Smoke P2) den Preset-Klick des zweiten Motivs ab; `panelZustand` verwirft die Sitzung seit Welle 38 vor dem Schließen, und `waehlePreset` prüft, dass der Chip aktiv ist und die Regler sich bewegt haben.
