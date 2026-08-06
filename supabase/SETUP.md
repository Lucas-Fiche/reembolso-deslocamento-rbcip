# Fase 0 — Preparo do Supabase (guia passo a passo)

> **Nada aqui afeta o sistema atual.** Você está montando o ambiente novo em
> paralelo. O sistema em produção (Google) continua intacto e no ar.
> Só seguimos para migrar dados quando este ambiente estiver validado.

Os arquivos `migrations/0001_esquema.sql` e `migrations/0002_seguranca.sql`
são o **desenho do banco** para você revisar. Quando aprovar, rode-os na sua
conta seguindo os passos abaixo.

---

## 1. Criar o projeto (grátis)
1. Entre em [supabase.com](https://supabase.com) → **New project**.
2. Nome: `rbcip-reembolso`. Guarde a **senha do banco** num lugar seguro.
3. Região: escolha **South America (São Paulo)** para menor latência.
4. Plano: **Free** (por enquanto).

## 2. Criar as tabelas
1. No projeto → **SQL Editor** → **New query**.
2. Cole o conteúdo de `0001_esquema.sql`, clique **Run**.
3. Repita com `0002_seguranca.sql`.
   - Se aparecer erro, **pare e me mande a mensagem** — corrijo antes de seguir.

## 3. Ligar o login por e-mail
Em **Authentication → Sign In / Providers** (seção CONFIGURATION):
- Abra **Email** e deixe **Enabled**.
  - O mesmo provedor Email cobre os dois logins: **senha** (admins) e
    **código/OTP** (motoristas e Van). Não precisa de provedor separado.
  - Ajustes finos de OTP ficam para a Fase 1.

## 4. E-mail para os códigos — SMTP do próprio `@rbcip.org` (Google Workspace)
O e-mail nativo do Supabase é limitado (só teste). Usamos o SMTP do próprio
domínio da RBCIP — **sem outro serviço**. Em **Authentication → Emails**
(NOTIFICATIONS) → **Enable custom SMTP**:

| Campo | Valor |
|---|---|
| Sender email address | `lucas@rbcip.org` (ou um endereço de função, ex. `sistema@rbcip.org`) |
| Sender name | `RBCIP Reembolso` |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | `lucas@rbcip.org` |
| Password | **Senha de app** do Google (não a senha normal) |

- Gere a senha de app em [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
  (precisa de verificação em 2 etapas ativa).
- O aviso amarelo "Check your SMTP provider" é **informativo** — o Gmail é feito
  para e-mail pessoal, mas para o baixo volume de códigos de login funciona bem.
- **Sempre teste a entrega real** (criar/convidar um usuário e ver se o e-mail
  chega). SMTP errado falha em silêncio.
- Limites: Custom SMTP libera 30 e-mails/hora por padrão (ajustável em
  **Authentication → Rate Limits**); Workspace envia ~2.000/dia.
- _Alternativa futura, se o volume crescer ou cair em spam:_ um provedor
  transacional como o Resend (plano grátis).

## 5. Ativar a "porta" da lista de autorizados
O arquivo `0002_seguranca.sql` já cria o gatilho que **bloqueia quem não está
na lista**. Para também não *enviar* código a quem é de fora (ideal):
- **Authentication → Auth Hooks** (BETA) → **Before User Created** → aponte
  para a função do banco (eu forneço a versão exata do hook na Fase 1).

## 6. Cadastrar o primeiro admin (você)
No **SQL Editor**, rode (troque pelo seu e-mail real):
```sql
insert into emails_autorizados (email, papel, nome, ativo)
values ('voce@rbcip.org', 'admin', 'Seu Nome', true);
```
Depois, em **Authentication → Users → Add user**, crie seu usuário admin com
e-mail + senha. O perfil admin é montado automaticamente pelo gatilho.

## 7. Guardar as chaves (só serão usadas na Fase 2)
O Supabase renomeou as chaves. Você vai precisar de três coisas:
- **Project URL** — em **Settings → Data API** (ou botão **Connect** no topo).
  Ex.: `https://xxxx.supabase.co`. **Seguro compartilhar.**
- **Publishable key** (`sb_publishable_...`) — em **Settings → API Keys**.
  Substitui a antiga "anon". Vai no frontend; a proteção real é a RLS.
  **Seguro compartilhar.**
- **Secret key** (`sb_secret_...`) — mesma tela. Substitui a antiga
  "service_role". **PRIVILEGIADA:** nunca no frontend, nunca colada em chat.
  Entra só no servidor (Vercel), e você mesmo cola lá.

(Ignore a aba "Legacy anon, service_role API keys" — use as novas chaves.)

---

## Hospedagem — Vercel + domínio da RBCIP (sobre o Wix)
Ponto importante: o **Wix não hospeda** um app próprio como o nosso (ele é um
site fechado). Mas o **domínio `rbcip.org` que está no Wix pode ser usado**:
- Hospedamos o app na **Vercel** (grátis, e dá um lugar seguro para segredos e
  para acionar o recibo).
- No painel de domínio (Wix/registrador), apontamos um **subdomínio** para a
  Vercel — por exemplo:
  - `reembolso.rbcip.org` → app do motorista
  - `painel.rbcip.org` → painel admin
- O site principal `rbcip.org` continua no Wix, sem mudança.

Assim você tem **o domínio da RBCIP e a hospedagem profissional**, sem conflito.

---

## O que vem depois (só com seu "ok")
- **Fase 1:** login (OTP + senha) e a tela de gestão de e-mails autorizados.
- **Fase 2:** migração dos dados da planilha e virada do formulário/painel.
- Cada fase roda em paralelo; **nada substitui a produção antes de validado.**
