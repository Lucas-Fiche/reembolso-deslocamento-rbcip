// ══════════════════════════════════════════════════════════════════════════
// RBCIP — Configuração do Supabase (chaves PÚBLICAS, seguras no frontend)
// ══════════════════════════════════════════════════════════════════════════
//
// Preencha os dois valores abaixo com os dados do SEU projeto Supabase:
//   Settings → Data API      → Project URL
//   Settings → API Keys      → Publishable key (sb_publishable_...)
//
// Estas duas chaves são seguras de expor no navegador — a proteção real dos
// dados é a RLS (Row Level Security) que já configuramos no banco.
// A "Secret key" (sb_secret_...) NUNCA entra aqui.
// ══════════════════════════════════════════════════════════════════════════

window.RBCIP_CONFIG = {
  SUPABASE_URL: "COLE_AQUI_A_PROJECT_URL",              // ex.: https://abcd1234.supabase.co
  SUPABASE_PUBLISHABLE_KEY: "COLE_AQUI_A_PUBLISHABLE_KEY" // ex.: sb_publishable_xxxxxxxx
};
