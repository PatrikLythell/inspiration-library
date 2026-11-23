/**
 * Auto-tagging for references people add themselves. Same model, vocabulary and prompt as the
 * scrape recipe (reference-library/scrape-recipe.md), so added references filter like the rest.
 */
import sharp from 'sharp'

export const TAG_MODEL = 'google/gemini-2.5-flash-lite'
const FALLBACK_MODEL = 'google/gemini-2.5-flash'

export const VOCAB: Record<string, string[]> = {
 "mood": [
  "playful",
  "bold",
  "calm",
  "warm",
  "cool",
  "elegant",
  "raw",
  "nostalgic",
  "moody",
  "energetic",
  "witty",
  "rebellious",
  "optimistic",
  "melancholic",
  "confident",
  "quirky",
  "serene",
  "luxurious",
  "friendly",
  "austere",
  "sensual",
  "mysterious",
  "earnest",
  "fresh"
 ],
 "style": [
  "minimal",
  "maximal",
  "brutalist",
  "retro",
  "vintage",
  "modernist",
  "swiss/international",
  "editorial",
  "organic",
  "handmade/crafted",
  "geometric",
  "futuristic",
  "tech",
  "corporate",
  "luxury",
  "naive",
  "pop",
  "psychedelic",
  "art deco",
  "folk",
  "grunge",
  "collage",
  "monochrome",
  "pastel",
  "neon",
  "earthy",
  "industrial",
  "scandinavian",
  "japanese",
  "mediterranean",
  "y2k"
 ],
 "medium": [
  "photography",
  "product photography",
  "lifestyle photography",
  "illustration",
  "flat vector",
  "3d render",
  "typography",
  "lettering",
  "logo/wordmark",
  "pattern",
  "collage",
  "motion still",
  "mockup",
  "print",
  "texture/material"
 ],
 "subject": [
  "logo",
  "typeface specimen",
  "packaging",
  "signage/wayfinding",
  "poster/advertising",
  "stationery",
  "editorial/print",
  "digital/ui",
  "social post",
  "merchandise/apparel",
  "interior/space",
  "food & drink",
  "people",
  "nature",
  "architecture",
  "product",
  "vehicle",
  "pattern",
  "abstract"
 ],
 "composition": [
  "centred",
  "symmetrical",
  "asymmetric",
  "grid",
  "repetition",
  "full-bleed",
  "close-up",
  "flat lay",
  "negative space",
  "layered",
  "diagonal",
  "stacked type",
  "framed",
  "busy/dense"
 ],
 "colour_character": [
  "vibrant",
  "muted",
  "pastel",
  "monochrome",
  "black & white",
  "dark",
  "light/airy",
  "high contrast",
  "duotone",
  "warm tones",
  "cool tones",
  "earth tones",
  "neon",
  "metallic"
 ],
 "era_reference": [
  "contemporary",
  "1920s-30s",
  "1950s",
  "1960s",
  "1970s",
  "1980s",
  "1990s",
  "2000s",
  "mid-century modern",
  "bauhaus",
  "swiss/international",
  "timeless"
 ],
 "typography_style": [
  "none",
  "geometric sans",
  "grotesque sans",
  "humanist sans",
  "condensed",
  "extended",
  "serif",
  "slab serif",
  "script",
  "rounded",
  "monospace",
  "custom lettering",
  "blackletter",
  "display/decorative"
 ]
}

const list = (k: string) => `[${VOCAB[k].map((v) => `'${v}'`).join(', ')}]`

const PROMPT = `You tag ONE image for a designers' visual reference library, searched by mood, style and colour (not by brand).
Return JSON only:
{"description": one concrete sentence of what is visible,
 "mood": 2-4 from ${list('mood')},
 "style": 2-4 from ${list('style')},
 "medium": 1-2 from ${list('medium')},
 "subject": 1-3 from ${list('subject')},
 "composition": 1-2 from ${list('composition')},
 "colour_character": 1-3 from ${list('colour_character')},
 "palette": 3-5 dominant colours as hex, ordered by area,
 "palette_names": same order, plain colour names,
 "era_reference": 1-2 from ${list('era_reference')},
 "typography_style": 1-2 from ${list('typography_style')},
 "keywords": 4-8 extra lowercase search words (materials, objects, techniques, feelings)}
Use only listed values for the listed fields.`

/** Downscales to 768 px JPEG q82 (the recipe's tagging size) and returns a data: URL. */
export async function toTagImage(data: Buffer): Promise<string> {
  const jpg = await sharp(data).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
  return `data:image/jpeg;base64,${jpg.toString('base64')}`
}

async function ask(model: string, dataUrl: string, context?: string) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? 'proxy'}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT + (context ? `\nContext (do not tag the brand): ${context}` : '') },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`tagging failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
  const json: any = await res.json()
  const text = String(json.choices?.[0]?.message?.content ?? '').trim().replace(/^```(json)?/, '').replace(/```$/, '').trim()
  const j = JSON.parse(text)
  for (const [k, allowed] of Object.entries(VOCAB)) if (Array.isArray(j[k])) j[k] = j[k].filter((v: string) => allowed.includes(v))
  j.keywords = (Array.isArray(j.keywords) ? j.keywords : []).map((v: unknown) => String(v).toLowerCase()).slice(0, 8)
  j.palette = (Array.isArray(j.palette) ? j.palette : []).filter((h: unknown) => /^#[0-9a-f]{6}$/i.test(String(h))).slice(0, 5)
  if (!j.palette.length) throw new Error('no palette')
  return j
}

/** Tags one image (data: URL from toTagImage). Retries once on the stronger model. */
export async function tagImage(dataUrl: string, context?: string) {
  try {
    return await ask(TAG_MODEL, dataUrl, context)
  } catch {
    return await ask(FALLBACK_MODEL, dataUrl, context)
  }
}
