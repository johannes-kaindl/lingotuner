# Aufnahme-Vertrag — README-Bilder

Skill `readme-shots` (global). Treiber `scripts/shots.ts`, Brücke importiert aus `../../tools/obsidian-cdp/` (Dach, nicht vendored). Fixture unter `docs/images/fixture/` (englisch, generisch, nur LingoTuner aktiv). Es ist **nicht** das Fixture des GUI-Smokes (`fixtures/vault/`): beide bauen ihren Vault nach `$STAGING_VAULTS_DIR`, der Aufnahme-Vault heißt `lingotuner-shots`, damit sie einander nicht überschreiben.

## Vorbedingungen, die dieser Vertrag NICHT selbst herstellt

1. **Aufnahme in einer Zweitinstanz** (eigenes `--user-data-dir`, eigener Port, Lock für diesen Port) — Freigabe Johannes, Welle 9. Die reguläre Instanz auf Port 9222 wird nicht angefasst. Profil: die aktuelle `.asar` aus dem regulären Profil hineinkopieren, Vault in `obsidian.json` eintragen.
2. **Obsidians Oberfläche läuft auf Englisch:** `language` in `obsidian.json` und `localStorage["language"]` auf `en`, danach Neustart. Der Treiber prüft das vor dem ersten Bild und bricht sonst mit Klartext ab.
3. **Der aktuelle Build ist im Aufnahme-Vault:** `npm run build && npm run shots -- --setup` legt ihn dort ab; der Treiber schaltet das Plugin bei Bedarf frei (Restricted Mode).
4. **Ein Motiv pro Lauf** (`--only <name>`). Ein Mehrmotiv-Lauf hat einmal eine leere Notiz „Untitled" im Vault angelegt (vermutlich ein Klick, der nach einer Layout-Änderung neben das Ziel fiel); der Treiber räumt sie inzwischen weg, die Einzelläufe sind trotzdem der belegte Weg.

## Das Modell ist eine Attrappe

Der Treiber startet auf Port 1236 einen Fake-Server, der einen festen, redaktionell gewählten Text streamt (Modellname `local-model`). Die Bilder zeigen dadurch immer dasselbe Ergebnis, unabhängig davon, was auf dem Rechner geladen ist; der echte LM-Studio-Port 1234 bleibt unberührt. Endpunkt und Modell setzt der Treiber selbst und stellt sie am Ende zurück (`http://127.0.0.1:1234`, Modell leer, Regler neutral).

## Bildvertrag

| Datei | Klasse | referenziert von | muss zeigen |
|---|---|---|---|
| `hero.png` | hero | README.md, README.de.md (Kopf) | Das ganze Fenster: Notiz „Draft reply to Sam" im Editor, rechts das LingoTuner-Panel mit Quelle „Selection: 175 characters", Preset „Maximum clarity" aktiv, vier Reglern am linken Anschlag, dem gestreamten Ergebnis und den vier Ausgängen (Replace selection, Replace note, Copy, New note) |
| `rounds.png` | feature | README.md, README.de.md (Usage) | Dasselbe Fenster nach zwei Runden: die Anmerkung „Keep the offer of another day.", das Ergebnis von Runde 2 und die Liste „Rounds" mit „Round 1 · from source · no note" und der aktiven „Round 2 · refined from round 1 · …". Aufgenommen in der Standardbreite der Seitenleiste (~300 px) |
| `settings.png` | feature | README.md, README.de.md (Configuration) | Den Einstellungen-Tab von „Connection" bis zum Ende von „Style": Endpunkt-Zeile mit grünem Haken und „active — this one is used", Modell, aufklappbares „Request", Timeout, Override-Ordner, „Write shipped texts into the folder", „No saved presets yet." Die Gruppe „Output" fehlt bewusst: der Tab ist länger als der Bildschirm |
| `dials.png` | detail | README.md, README.de.md (Usage) | Nur das Panel, Preset „Collegial" aktiv, die vier Regler auf verschiedenen Stufen mit ihren Stufennamen („somewhat more direct", „somewhat warmer"), leere Anmerkung, Knopf „Tune", Statuszeile „Ready" und der leere Vorschaubereich „The tuned text appears here." |

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

Alle vier Bilder liegen (2026-09-26), Zweitinstanz auf Port 9325, jedes Bild selbst angesehen.

- `rounds.png` entstand zuerst bei 460 px Seitenleiste, weil die Zeile der aktiven Runde in der Standardbreite links abgeschnitten wurde. Der Fehler ist behoben (`styles.css`: `.lt-history-row` bricht um), gemessen vom Smoke-Punkt R1; das Bild ist in Standardbreite neu aufgenommen.
- Der Fake-Server-Port 1236 muss frei sein; der Treiber meldet es, wenn nicht.
