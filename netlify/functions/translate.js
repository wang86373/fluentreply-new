const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function (event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return jsonError(405, "Method not allowed");
    }

    const body = JSON.parse(event.body || "{}");

    const {
      text = "",
      sourceLanguage = "auto",
      targetLanguage = "English",
      task = "translate",
      glossary = [],
      engineMode = "auto",
      uiLanguage = "zh",
      sentenceMode = true
    } = body;

    if (!text.trim()) {
      return jsonError(400, "Missing text");
    }

    let deeplText = "";
    let deeplUsed = false;
    let deeplError = "";

    const shouldUseDeepL =
      process.env.DEEPL_API_KEY &&
      task === "translate" &&
      engineMode !== "ai" &&
      isDeepLSupported(targetLanguage);

    if (shouldUseDeepL) {
      try {
        deeplText = await translateWithDeepL(text, sourceLanguage, targetLanguage);
        deeplUsed = Boolean(deeplText);
      } catch (error) {
        deeplError = error.message || "DeepL failed";
      }
    }

    if (engineMode === "deepl" && deeplText) {
      return json(buildDeepLOnlyResult({
        text,
        deeplText,
        sourceLanguage,
        targetLanguage,
        uiLanguage
      }));
    }

    const aiResult = await enhanceWithAI({
      originalText: text,
      deeplText,
      sourceLanguage,
      targetLanguage,
      task,
      glossary,
      uiLanguage,
      sentenceMode
    });

    aiResult.engine_used = deeplUsed ? "DeepL + AI" : "AI only";
    aiResult.deepl_used = deeplUsed;
    aiResult.deepl_error = deeplError;

    return json(normalizeResult(aiResult, {
      originalText: text,
      fallbackText: deeplText,
      uiLanguage
    }));

  } catch (error) {
    return jsonError(500, "Server error", error.message);
  }
};

function json(body) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function jsonError(statusCode, error, detail = "") {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify({ error, detail })
  };
}

function buildDeepLOnlyResult({ text, deeplText, sourceLanguage, targetLanguage, uiLanguage }) {
  return {
    detected_language: sourceLanguage,
    target_language: targetLanguage,
    full_translation: deeplText,
    engine_used: "DeepL only",
    deepl_used: true,
    deepl_error: "",
    segments: [
      {
        id: 1,
        source: text,
        best: deeplText,
        options: [
          {
            label: "DeepL",
            text: deeplText,
            meaning: meaning(uiLanguage, "deepl")
          },
          {
            label: "Natural",
            text: deeplText,
            meaning: meaning(uiLanguage, "natural")
          },
          {
            label: "Alternative",
            text: deeplText,
            meaning: meaning(uiLanguage, "alternative")
          }
        ]
      }
    ]
  };
}

async function translateWithDeepL(text, sourceLanguage, targetLanguage) {
  const target = mapDeepLLang(targetLanguage);

  if (!target) {
    throw new Error("DeepL does not support this target language");
  }

  const params = new URLSearchParams();
  params.append("text", text);
  params.append("target_lang", target);

  const source = mapDeepLLang(sourceLanguage);
  if (sourceLanguage !== "auto" && source) {
    params.append("source_lang", source);
  }

  const endpoint =
    process.env.DEEPL_API_URL ||
    "https://api-free.deepl.com/v2/translate";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "DeepL failed");
  }

  return data.translations?.[0]?.text || "";
}

async function enhanceWithAI({
  originalText,
  deeplText,
  sourceLanguage,
  targetLanguage,
  task,
  glossary,
  uiLanguage,
  sentenceMode
}) {
  if (!process.env.OPENAI_API_KEY) {
    if (deeplText) {
      return buildDeepLOnlyResult({
        text: originalText,
        deeplText,
        sourceLanguage,
        targetLanguage,
        uiLanguage
      });
    }

    throw new Error("Missing OPENAI_API_KEY");
  }

  const explanationLanguage = getExplanationLanguage(uiLanguage);
  const glossaryText = buildGlossaryText(glossary);
  const taskPrompt = getTaskPrompt(task);

  const segmentationRule = sentenceMode
    ? `
Sentence mode is ON:
- Split the ORIGINAL input into natural sentence-level segments.
- Each segment must preserve the full-message context.
- Each segment must have its own best translation and 3 options.
- Do not translate segments as isolated sentences.
`
    : `
Sentence mode is OFF:
- Return exactly ONE segment for the entire message.
- The segment must contain the complete full-message translation.
- The 3 options must be 3 complete full-message expressions.
`;

  const prompt = `
You are FluentReply, a professional multilingual translation assistant.

Task:
${taskPrompt}

Source language:
${sourceLanguage}

Target language:
${targetLanguage || "auto"}

Explanation language:
${explanationLanguage}

Original input:
${originalText}

DeepL base translation:
${deeplText || "No DeepL result provided."}

Glossary:
${glossaryText}

CORE RULES:
- Translate the FULL original input.
- Never drop, skip, shorten, or ignore any sentence.
- If DeepL base translation exists, use it as the main meaning reference.
- The final translation must be in the target language.
- Explanations must be in ${explanationLanguage}.
- Support all language pairs.
- Keep chat messages natural, human, and context-aware.
- Keep pronouns, relationships, tone, gender references, and logic consistent.
- Apply glossary terms strictly.
- Do not invent new subjects, locations, emotions, or relationships.

CHINESE AFFECTIONATE TERMS:
- If Chinese "亲爱的" appears in romantic, affectionate, or close chat context, include "Honey" as Natural or Alternative.
- For "亲爱的", options should consider: Honey, Sweetheart, Babe, Dear.
- For "宝贝", options should consider: Baby, Babe, Sweetheart.
- For "老公", options should consider: Honey, Hubby, Husband depending on context.
- For "老婆", options should consider: Honey, Sweetheart, Wife depending on context.

${segmentationRule}

OPTION RULES:
- Every segment must have exactly 3 options:
  1. Closest
  2. Natural
  3. Alternative
- Each option text must be in the target language.
- Each option meaning must be in ${explanationLanguage}.
- Closest = most faithful to original meaning.
- Natural = most natural conversational expression.
- Alternative = another natural expression with the same meaning.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No comments.
- No extra text.

JSON format:
{
  "detected_language": "detected source language",
  "target_language": "target language",
  "full_translation": "complete translation of the full input",
  "segments": [
    {
      "id": 1,
      "source": "original text or sentence",
      "best": "best translation",
      "options": [
        {"label":"Closest","text":"...","meaning":"..."},
        {"label":"Natural","text":"...","meaning":"..."},
        {"label":"Alternative","text":"...","meaning":"..."}
      ]
    }
  ]
}
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: prompt,
      temperature: 0.2
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI API error");
  }

  const outputText =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text;

  if (!outputText) {
    throw new Error("No output from OpenAI");
  }

  const cleaned = outputText
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

function normalizeResult(parsed, { originalText, fallbackText, uiLanguage }) {
  if (!parsed || typeof parsed !== "object") {
    parsed = {};
  }

  if (!parsed.full_translation && Array.isArray(parsed.segments)) {
    parsed.full_translation = parsed.segments.map(s => s.best || "").join(" ").trim();
  }

  if (!parsed.full_translation) {
    parsed.full_translation = fallbackText || "";
  }

  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    parsed.segments = [
      {
        id: 1,
        source: originalText,
        best: parsed.full_translation,
        options: [
          {
            label: "Closest",
            text: parsed.full_translation,
            meaning: meaning(uiLanguage, "closest")
          },
          {
            label: "Natural",
            text: parsed.full_translation,
            meaning: meaning(uiLanguage, "natural")
          },
          {
            label: "Alternative",
            text: parsed.full_translation,
            meaning: meaning(uiLanguage, "alternative")
          }
        ]
      }
    ];
  }

  parsed.segments = parsed.segments.map((seg, index) => {
    let options = Array.isArray(seg.options) ? seg.options : [];

    while (options.length < 3) {
      const type =
        options.length === 0 ? "closest" :
        options.length === 1 ? "natural" :
        "alternative";

      options.push({
        label:
          type === "closest" ? "Closest" :
          type === "natural" ? "Natural" :
          "Alternative",
        text: seg.best || parsed.full_translation || fallbackText || "",
        meaning: meaning(uiLanguage, type)
      });
    }

    options = options.slice(0, 3).map((opt, optIndex) => ({
      label:
        opt.label ||
        (optIndex === 0 ? "Closest" : optIndex === 1 ? "Natural" : "Alternative"),
      text: opt.text || seg.best || parsed.full_translation || fallbackText || "",
      meaning: opt.meaning || meaning(
        uiLanguage,
        optIndex === 0 ? "closest" : optIndex === 1 ? "natural" : "alternative"
      )
    }));

    return {
      id: seg.id || index + 1,
      source: seg.source || originalText,
      best: seg.best || options[0].text || parsed.full_translation || fallbackText || "",
      options
    };
  });

  return parsed;
}

function getExplanationLanguage(uiLanguage) {
  if (uiLanguage === "zh") return "Simplified Chinese";
  if (uiLanguage === "ja") return "Japanese";
  return "English";
}

function buildGlossaryText(glossary) {
  if (!Array.isArray(glossary) || glossary.length === 0) {
    return "No glossary provided.";
  }

  return glossary
    .filter(item => item && item.source && item.target)
    .map(item => `${item.source} = ${item.target}`)
    .join("\n");
}

function getTaskPrompt(task) {
  if (task === "headline") {
    return "Rewrite or translate the entire input as a professional news headline. Do not drop key information.";
  }

  if (task === "vocab") {
    return "Extract important vocabulary from the entire input and explain each term briefly.";
  }

  if (task === "news") {
    return "Translate the entire input as professional, neutral news content.";
  }

  return "Translate accurately and naturally.";
}

function meaning(lang, type) {
  const zh = {
    deepl: "基于 DeepL 的快速精准整段翻译。",
    closest: "最贴近原文意思的翻译。",
    natural: "更自然、更口语化的表达，但意思不变。",
    alternative: "另一种自然表达方式，意思保持一致。"
  };

  const ja = {
    deepl: "DeepL に基づく高速で正確な全文翻訳です。",
    closest: "原文の意味に最も忠実な翻訳です。",
    natural: "より自然な表現ですが、意味は同じです。",
    alternative: "同じ意味を持つ別の自然な表現です。"
  };

  const en = {
    deepl: "Fast precise full translation based on DeepL.",
    closest: "The closest translation to the original meaning.",
    natural: "A more natural expression with the same meaning.",
    alternative: "Another natural way to express the same meaning."
  };

  if (lang === "zh") return zh[type];
  if (lang === "ja") return ja[type];
  return en[type];
}

function isDeepLSupported(lang) {
  return Boolean(mapDeepLLang(lang));
}

function mapDeepLLang(lang) {
  const map = {
    English: "EN",
    "Simplified Chinese": "ZH",
    Chinese: "ZH",
    Japanese: "JA",
    Korean: "KO",
    Spanish: "ES",
    French: "FR",
    German: "DE",
    Russian: "RU",
    Portuguese: "PT",
    Italian: "IT",
    Dutch: "NL",
    Polish: "PL",
    Arabic: "AR",
    Turkish: "TR",
    Ukrainian: "UK",
    Thai: null,
    Vietnamese: null,
    Burmese: null,
    auto: null
  };

  return map[lang] || null;
}
