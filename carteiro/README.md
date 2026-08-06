# Carteiro RBCIP — envio de e-mails na fase híbrida

Apps Script **novo e isolado** que só envia os e-mails de aviso de status. O
painel novo (Supabase) grava o status e chama este carteiro para disparar o
e-mail — **idêntico** ao do sistema atual. **Não toca no sistema de produção.**

## Por que é seguro
- Antes de enviar, ele confere no Supabase que quem pediu é **admin**.
- Ele busca nome/e-mail/valor **do próprio Supabase** pelo protocolo — o
  destinatário nunca vem do navegador, então não dá para usar como spam.

## Passo a passo (uma vez só)

1. Acesse **https://script.google.com** → **Novo projeto**.
2. Apague o conteúdo padrão e **cole todo o `carteiro.gs`**. Dê um nome ao
   projeto (ex.: `RBCIP Carteiro`).
3. **Configurações do projeto** (engrenagem) → role até **Propriedades do
   script** → adicione duas:
   - `SUPABASE_URL` = `https://oharmunvmkrtlfpgsgww.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_...` (a mesma do `web/config.js`)
4. **Implantar** → **Nova implantação** → tipo **App da Web**:
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
   - **Implantar** → autorize as permissões (é o pedido de acesso ao Gmail
     para enviar e-mail, em nome da sua conta — a mesma que envia hoje).
5. Copie a **URL da Web** gerada (termina em `/exec`).
6. Me mande essa URL: eu coloco em `web/config.js` (`CARTEIRO_URL`) e publico —
   ou você mesmo cola lá entre as aspas.

## Testar
No painel, mude o status de um registro (ex.: **Aprovar**). Deve aparecer
*"Status salvo e e-mail enviado ao pesquisador ✉️"* e o e-mail chega ao
endereço cadastrado naquele reembolso.

> Enquanto `CARTEIRO_URL` estiver vazio no `config.js`, o painel só grava o
> status (sem e-mail) — exatamente o comportamento da Camada A.
