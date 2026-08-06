# Fase 1 — Login + gestão de e-mails autorizados

Mini-app de teste (isolado da produção) para validar a autenticação nova:
login por **código** (motorista/Van), login por **senha** (admin) e a tela de
**e-mails autorizados** (só admin, protegida pela RLS).

## Arquivos
- `config.js` — **preencha** com sua Project URL e Publishable key.
- `login.html` — tela de entrada (código ou senha).
- `autorizados.html` — cadastro de quem pode acessar (só admin).
- `estilo.css` — visual compartilhado.

## Como testar

### 1. Preencher a configuração
Abra `web/config.js` e cole os dois valores públicos do seu projeto:
- `SUPABASE_URL` → **Settings → Data API → Project URL**
- `SUPABASE_PUBLISHABLE_KEY` → **Settings → API Keys → Publishable key** (`sb_publishable_...`)

### 2. Abrir as páginas
O jeito mais confiável é servir a pasta localmente (evita restrições de `file://`):

```bash
cd web
python3 -m http.server 5173
```
Depois abra <http://localhost:5173/login.html> no navegador.
(Se preferir, dá para só abrir o `login.html` direto — mas o servidor local é mais seguro.)

### 3. Roteiro de teste
1. **Admin por senha:** em `login.html`, clique em "Sou administrador", entre com
   `lucas@rbcip.org` + senha. Deve aparecer seu nome com o papel **admin** e o
   botão "Gerir e-mails autorizados".
2. **Gestão de autorizados:** abra `autorizados.html`. Cadastre um e-mail de
   teste como **motorista**.
3. **Login por código:** saia, e em `login.html` entre com esse e-mail de teste
   pelo código recebido por e-mail. Deve logar como **motorista** (sem o botão de admin).
4. **Bloqueio funciona:** tente entrar por código com um e-mail que **não** está
   na lista → deve recusar ("e-mail não autorizado").

Se algum passo falhar, me manda o print/erro que eu ajusto.

> Observação: nesta fase o código ainda é *enviado* mesmo para quem é de fora
> (o bloqueio acontece na confirmação). Fechar essa porta no envio é o passo do
> "Before User Created Hook", que faremos com cuidado antes de ir para produção.
