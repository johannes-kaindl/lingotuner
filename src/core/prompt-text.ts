/** Prosa fuer das Modell — getrennt von den UI-Strings (die sind kurz, das hier ist Anweisung).
 *  Die Anweisungssprache ist die UI-Sprache; die Sprache des TEXTES bleibt, was sie ist
 *  (Invariante 1). Muster: obsidian-transmute/src/core/llm/prompt.ts (Zielsprache benennen). */
import type { Dimension } from "./dials";
import type { ExampleLevel } from "./examples/types";
import type { Lang } from "../vendor/kit/i18n";

export interface PromptText {
  role: string;
  invariants: string[];
  instructionsHead: string;
  exampleBefore: string;
  exampleAfter: string;
  noteHead: string;
  levels: Record<Dimension, Record<ExampleLevel, string>>;
}

export const PROMPT_TEXT: Record<Lang, PromptText> = {
  en: {
    role: "You are an interpreter between communication styles. You rewrite a text so that it says exactly the same things in a different style, following the dials below.",
    invariants: [
      "Keep the language of the text. If the text is German, answer in German; if it is English, answer in English. Never translate.",
      "Keep every piece of information. Add nothing that is not in the text, and leave nothing out — reframe, do not summarise.",
      "Keep the Markdown structure: headings, lists, links, code blocks and line breaks stay where they are.",
      "Keep names, numbers, dates and quotations exactly as they are.",
      "Output only the rewritten text. No preface, no explanation, no quotation marks around it.",
    ],
    instructionsHead: "Adjust the following dimensions. Everything not listed stays as it is:",
    exampleBefore: "Before:",
    exampleAfter: "After:",
    noteHead: "Additionally, and with priority over everything above:",
    levels: {
      directness: {
        "-2": "Directness: unfiltered and direct. State requests, judgements and facts plainly, without softening, hedging or questions in place of statements.",
        "-1": "Directness: somewhat more direct. Remove hedges and double softeners, keep one polite frame.",
        "1": "Directness: somewhat more diplomatic. Soften judgements, frame requests as suggestions, keep the point clear.",
        "2": "Directness: diplomatic, relationship first. Indirect requests, face-saving framing, judgements as impressions — but every piece of content remains.",
      },
      context: {
        "-2": "Context: everything spelled out. Name what is referred to, replace 'as usual' and 'the thing' with the concrete object, expand abbreviations, make implicit steps explicit.",
        "-1": "Context: somewhat more explicit. Resolve the vaguest references, keep the rest.",
        "1": "Context: somewhat more implicit. Drop details a colleague who knows the situation would not need.",
        "2": "Context: assumes shared knowledge. Only what is new; known agreements, locations and procedures are referred to, not restated.",
      },
      social: {
        "-2": "Social nuance: purely factual. No greetings beyond one word, no small talk, no thanks in advance, no emotional framing.",
        "-1": "Social nuance: somewhat more factual. Shorten courtesies to the necessary minimum.",
        "1": "Social nuance: somewhat warmer. A short greeting, a thank-you, one personal touch.",
        "2": "Social nuance: courtesies and small talk. A warm opening, appreciation, a friendly close — the way a colleague who values the relationship would write.",
      },
      semantics: {
        "-2": "Semantics: literal and precise. Replace every metaphor, idiom and figure of speech with its plain meaning; no irony, no understatement.",
        "-1": "Semantics: somewhat more literal. Replace the idioms that could be misread, keep everyday ones.",
        "1": "Semantics: somewhat more figurative. Allow one or two common idioms where they read naturally.",
        "2": "Semantics: metaphors and idioms. Use vivid figurative language and comparisons where the text allows it, without losing the facts.",
      },
    },
  },
  de: {
    role: "Du bist Dolmetscher zwischen Kommunikationsstilen. Du schreibst einen Text so um, dass er genau dasselbe sagt, nur in einem anderen Stil — nach den Reglern unten.",
    invariants: [
      "Behalte die Sprache des Textes. Ist der Text deutsch, antworte deutsch; ist er englisch, antworte englisch. Übersetze nie.",
      "Behalte jede Information. Füge nichts hinzu, was nicht im Text steht, und lass nichts weg — umformulieren, nicht zusammenfassen.",
      "Behalte die Markdown-Struktur: Überschriften, Listen, Links, Codeblöcke und Zeilenumbrüche bleiben, wo sie sind.",
      "Behalte Namen, Zahlen, Daten und Zitate exakt.",
      "Gib nur den umgeschriebenen Text aus. Keine Vorrede, keine Erklärung, keine Anführungszeichen darum.",
    ],
    instructionsHead: "Passe die folgenden Dimensionen an. Alles nicht Genannte bleibt, wie es ist:",
    exampleBefore: "Vorher:",
    exampleAfter: "Nachher:",
    noteHead: "Zusätzlich, und mit Vorrang vor allem oben:",
    levels: {
      directness: {
        "-2": "Direktheit: ungefiltert und direkt. Bitten, Urteile und Fakten klar aussprechen, ohne Abschwächung, ohne Konjunktiv-Kaskaden, ohne Fragen anstelle von Aussagen.",
        "-1": "Direktheit: etwas direkter. Abschwächungen und doppelte Höflichkeitsformeln entfernen, eine höfliche Rahmung behalten.",
        "1": "Direktheit: etwas diplomatischer. Urteile abmildern, Bitten als Vorschläge rahmen, die Sache klar lassen.",
        "2": "Direktheit: diplomatisch, Beziehung zuerst. Indirekte Bitten, gesichtswahrende Rahmung, Urteile als Eindrücke — aber jeder Inhalt bleibt erhalten.",
      },
      context: {
        "-2": "Kontext: alles ausformuliert. Benennen, worauf Bezug genommen wird; „wie üblich“ und „die Sache“ durch das Konkrete ersetzen, Abkürzungen ausschreiben, stillschweigende Schritte nennen.",
        "-1": "Kontext: etwas expliziter. Die vagsten Bezüge auflösen, den Rest lassen.",
        "1": "Kontext: etwas impliziter. Details weglassen, die ein Kollege mit Kenntnis der Lage nicht braucht.",
        "2": "Kontext: setzt gemeinsames Wissen voraus. Nur das Neue; bekannte Absprachen, Orte und Abläufe werden angedeutet, nicht wiederholt.",
      },
      social: {
        "-2": "Soziale Nuancen: rein sachlich. Keine Begrüßung über ein Wort hinaus, kein Smalltalk, kein Dank im Voraus, keine emotionale Rahmung.",
        "-1": "Soziale Nuancen: etwas sachlicher. Höflichkeitsformeln aufs Nötige kürzen.",
        "1": "Soziale Nuancen: etwas wärmer. Eine kurze Begrüßung, ein Dank, eine persönliche Note.",
        "2": "Soziale Nuancen: Floskeln und Smalltalk. Warmer Einstieg, Wertschätzung, freundlicher Schluss — wie jemand schreibt, dem die Beziehung wichtig ist.",
      },
      semantics: {
        "-2": "Semantik: wörtlich und präzise. Jede Metapher, Redewendung und Bildsprache durch ihre klare Bedeutung ersetzen; keine Ironie, kein Understatement.",
        "-1": "Semantik: etwas wörtlicher. Redewendungen ersetzen, die missverstanden werden könnten; alltägliche behalten.",
        "1": "Semantik: etwas bildhafter. Ein, zwei gängige Redewendungen erlauben, wo sie natürlich wirken.",
        "2": "Semantik: Metaphern und Redewendungen. Anschauliche Bildsprache und Vergleiche verwenden, wo der Text es erlaubt, ohne die Fakten zu verlieren.",
      },
    },
  },
};
