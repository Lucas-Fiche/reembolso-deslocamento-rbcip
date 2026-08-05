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
Em **Authentication → Providers**:
- **Email** habilitado.
  - Ative **"Confirm email" / OTP** (código) — usado pelos motoristas e Van.
  - Mantenha **senha** habilitada — usada pelos admins.

## 4. E-mail confiável para os códigos (grátis)
O e-mail nativo do Supabase é limitado (só teste). Para o código chegar sempre:
1. Crie conta grátis no [Resend](https://resend.com) (100 e-mails/dia grátis).
2. Verifique um remetente (ex.: `no-reply@rbcip.org`).
3. Em **Authentication → Emails / SMTP settings** do Supabase, preencha o SMTP do Resend.

## 5. Ativar a "porta" da lista de autorizados
O arquivo `0002_seguranca.sql` já cria o gatilho que **bloqueia quem não está
na lista**. Para também não *enviar* código a quem é de fora (ideal):
- **Authentication → Hooks → Before User Created** → aponte para a função
  do banco (eu forneço a versão exata do hook na Fase 1, junto do login).

## 6. Cadastrar o primeiro admin (você)
No **SQL Editor**, rode (troque pelo seu e-mail real):
```sql
insert into emails_autorizados (email, papel, nome, ativo)
values ('voce@rbcip.org', 'admin', 'Seu Nome', true);
```
Depois, em **Authentication → Users → Add user**, crie seu usuário admin com
e-mail + senha. O perfil admin é montado automaticamente pelo gatilho.

## 7. Guardar as chaves (para a Fase 2, no frontend)
Em **Project Settings → API**, copie e me envie de forma segura quando for a hora:
- **Project URL**
- **anon public key** (pode ir no frontend; a proteção real é a RLS)
- ⚠️ A **service_role key** é secreta — **nunca** vai no frontend. Fica só no
  servidor (Vercel). Não cole em lugar público.

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
