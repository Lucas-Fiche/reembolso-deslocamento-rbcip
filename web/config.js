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
  // URL base do projeto (SEM o /rest/v1/ — o supabase-js acrescenta sozinho)
  SUPABASE_URL: "https://oharmunvmkrtlfpgsgww.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_kDWEzxNW7OpZB4VzqgcJ8g_QcEIWH7W"
};
