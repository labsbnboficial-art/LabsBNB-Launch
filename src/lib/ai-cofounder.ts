export const AI_COFOUNDER_PERSONALITIES = ["degen", "sarcastic", "financial", "meme_lord"] as const;
export type AiCofounderPersonality = (typeof AI_COFOUNDER_PERSONALITIES)[number];

export const AI_COFOUNDER_LABEL: Record<AiCofounderPersonality, { label: string; emoji: string; hint: string }> = {
  degen: { label: "Degen / Hype", emoji: "🚀", hint: "Energía máxima, todo es a la luna." },
  sarcastic: { label: "Sarcástico", emoji: "😏", hint: "Ironía fina y humor ácido." },
  financial: { label: "Financiero", emoji: "📊", hint: "Tono analítico, datos y métricas." },
  meme_lord: { label: "Meme Lord", emoji: "🐸", hint: "Cultura meme pura." },
};

export type AiCofounderConfig = {
  enabled: boolean;
  personality: AiCofounderPersonality;
  lore: string;
  updatedAt?: string;
};
