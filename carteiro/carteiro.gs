// ══════════════════════════════════════════════════════════════════════════
// RBCIP — CARTEIRO (Apps Script isolado, só envia e-mails)
// ══════════════════════════════════════════════════════════════════════════
// Ponte da fase híbrida: o painel novo (Supabase) grava o status e chama este
// carteiro para disparar o e-mail de aviso ao pesquisador (modelo "recibo").
//
// Este script NÃO toca no sistema de produção. É um projeto Apps Script novo,
// separado, dedicado só a enviar e-mail.
//
// SEGURANÇA (por que ninguém consegue abusar):
//   1) Confere no Supabase que quem chamou é ADMIN (usando o token do próprio
//      usuário logado — perfis.papel = 'admin').
//   2) Busca nome/e-mail/valor DO PRÓPRIO Supabase pelo protocolo — o
//      destinatário nunca vem do navegador, então não dá para mandar e-mail
//      para endereço arbitrário.
//
// CONFIGURAÇÃO (Configurações do projeto → Propriedades do script):
//   SUPABASE_URL              = https://oharmunvmkrtlfpgsgww.supabase.co
//   SUPABASE_PUBLISHABLE_KEY  = sb_publishable_...
// (São as MESMAS chaves públicas do web/config.js. Nada secreto aqui.)
// ══════════════════════════════════════════════════════════════════════════

var CONTATO_BUSINESS = "+55 11 93623-3054"; // mesmo contato dos e-mails atuais

function _props(){ return PropertiesService.getScriptProperties(); }
function _jr(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e){
  try{
    var d = JSON.parse(e.postData.contents);
    if(d.action === "enviar_aviso_status") return enviarAvisoStatus(d);
    if(d.action === "enviar_confirmacao_registro") return enviarConfirmacao(d);
    if(d.action === "upload_imagem") return uploadImagem(d);
    if(d.action === "upload_imagens") return uploadImagens(d);
    if(d.action === "gerar_recibo") return gerarReciboAction(d);
    return _jr({success:false, error:"Ação desconhecida"});
  }catch(err){ return _jr({success:false, error:String(err && err.message || err)}); }
}

// ── E-mail de confirmação ao registrar (enviado ao próprio motorista) ──
function enviarConfirmacao(d){
  if(!d.jwt || !d.protocolo) return _jr({success:false, error:"Dados incompletos."});
  var perfil = _sbGet("perfis?select=papel", d.jwt);
  if(!perfil || !perfil.length) return _jr({success:false, error:"Não autorizado."});
  var m = _dadosViagem(d.protocolo, d.jwt);   // RLS: o pesquisador só lê o que é dele
  if(!m) return _jr({success:false, error:"Protocolo não encontrado."});
  if(!m.email) return _jr({success:true, enviado:false, motivo:"sem e-mail"});
  var envio;
  try{
    var im = _imagensEmail(EMAIL_REGISTRO.ilus, m), em = _htmlRegistro(m, im.src);
    envio = { to:m.email, subject:em.assunto, htmlBody:em.html, inlineImages:im.inline, name:"RBCIP · Reembolsos" };
  }catch(montErr){
    envio = { to:m.email, subject:EMAIL_REGISTRO.assunto+d.protocolo, name:"RBCIP · Reembolsos",
      htmlBody:'<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto"><h2 style="color:#0B4F6C">'+_h(EMAIL_REGISTRO.titulo(m.primeiroNome))+'</h2>'
        +'<p>'+_h(EMAIL_REGISTRO.sub)+'</p><p>Protocolo: <b>'+_h(d.protocolo)+'</b> · '+_brl(m.total)+'</p><p>Dúvidas: '+CONTATO_BUSINESS+'</p></div>' };
  }
  try{ MailApp.sendEmail(envio); }
  catch(err){ return _jr({success:false, error:"Falha no e-mail: "+String(err && err.message || err)}); }
  return _jr({success:true, enviado:true, para:m.email});
}

// ── Upload de imagem ao Drive (para o formulário do motorista) ──
// Segurança: exige um token de usuário AUTENTICADO no Supabase (a RLS de
// 'perfis' só devolve linha para quem está logado). Salva numa pasta do Drive
// e devolve o link público de visualização (para o painel exibir a foto).
function uploadImagem(d){
  if(!d.jwt || !d.base64) return _jr({success:false, error:"Dados incompletos."});
  var perfil = _sbGet("perfis?select=papel", d.jwt);
  if(!perfil || !perfil.length) return _jr({success:false, error:"Não autorizado."});
  var folderId = _props().getProperty("DRIVE_FOLDER_ID");
  if(!folderId) return _jr({success:false, error:"DRIVE_FOLDER_ID não configurado no carteiro."});
  try{
    var b64 = String(d.base64).replace(/^data:[^;]+;base64,/, "");
    var bytes = Utilities.base64Decode(b64);
    var nome = (d.protocolo?d.protocolo+"_":"") + (d.name||"foto") + ".jpg";
    var blob = Utilities.newBlob(bytes, "image/jpeg", nome);
    var file = DriveApp.getFolderById(folderId).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return _jr({success:true, link:file.getUrl()});
  }catch(err){
    return _jr({success:false, error:"Falha no upload: " + String(err && err.message || err)});
  }
}

// Upload de VÁRIAS imagens numa única execução (o formulário manda todas as
// fotos do check-out juntas — menos requisições = mais robusto sob carga).
// items: [{name, base64}, ...]  → devolve { links: { name: url, ... } }.
function uploadImagens(d){
  if(!d.jwt || !d.items || !d.items.length) return _jr({success:false, error:"Dados incompletos."});
  var perfil = _sbGet("perfis?select=papel", d.jwt);
  if(!perfil || !perfil.length) return _jr({success:false, error:"Não autorizado."});
  var folderId = _props().getProperty("DRIVE_FOLDER_ID");
  if(!folderId) return _jr({success:false, error:"DRIVE_FOLDER_ID não configurado no carteiro."});
  try{
    var folder = DriveApp.getFolderById(folderId);
    var links = {};
    for(var i=0;i<d.items.length;i++){
      var it = d.items[i];
      if(!it || !it.base64) continue;
      var b64 = String(it.base64).replace(/^data:[^;]+;base64,/, "");
      var bytes = Utilities.base64Decode(b64);
      var key = it.name || ("foto"+i);
      var nome = (d.protocolo?d.protocolo+"_":"") + key + ".jpg";
      var file = folder.createFile(Utilities.newBlob(bytes, "image/jpeg", nome));
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      links[key] = file.getUrl();
    }
    return _jr({success:true, links:links});
  }catch(err){
    return _jr({success:false, error:"Falha no upload: " + String(err && err.message || err)});
  }
}

function doGet(){ return _jr({status:"ok", carteiro:"rbcip", v:"1.4"}); }

// Rode UMA vez no editor (menu ▶ Executar) para autorizar Drive + Docs.
function autorizar(){
  var d = DocumentApp.create("rbcip_autorizacao_temp");
  DriveApp.getFileById(d.getId()).setTrashed(true);
  return "Drive e Docs autorizados.";
}

// ── Recibo em PDF (a partir de um Doc modelo com tags <<...>>) ──
function dataPorExtenso(dt){
  var m=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return dt.getDate()+" de "+m[dt.getMonth()]+" de "+dt.getFullYear();
}
function valorPorExtenso(v){
  v=Number(v)||0; var reais=Math.floor(v+1e-9), centavos=Math.round((v-reais)*100);
  var u=["","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
  var d=["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  var c=["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
  function tres(n){ if(n===0)return""; if(n===100)return"cem"; var s=[],cent=Math.floor(n/100),resto=n%100; if(cent>0)s.push(c[cent]); if(resto>0){ if(resto<20)s.push(u[resto]); else{var dez=Math.floor(resto/10),uni=resto%10; s.push(d[dez]+(uni>0?" e "+u[uni]:""));} } return s.join(" e "); }
  function ext(n){ if(n===0)return"zero"; var p=[],mi=Math.floor(n/1000000),mil=Math.floor((n%1000000)/1000),r=n%1000; if(mi>0)p.push(mi===1?"um milhão":tres(mi)+" milhões"); if(mil>0)p.push(mil===1?"mil":tres(mil)+" mil"); if(r>0)p.push(tres(r)); return p.join(" e "); }
  var txt=""; if(reais>0)txt+=ext(reais)+(reais===1?" real":" reais");
  if(centavos>0){ if(reais>0)txt+=" e "; txt+=ext(centavos)+(centavos===1?" centavo":" centavos"); }
  if(reais===0&&centavos===0)txt="zero reais"; return txt;
}
function proximoNumeroRecibo(){ var n=parseInt(_props().getProperty("RECIBO_SEQ")||"0",10)+1; _props().setProperty("RECIBO_SEQ",String(n)); return ("00"+n).slice(-3); }

function gerarReciboAction(d){
  if(!d.jwt || !d.protocolo) return _jr({success:false, error:"Dados incompletos."});
  if(!_ehAdmin(d.jwt)) return _jr({success:false, error:"Não autorizado (apenas admin)."});
  var tid=_props().getProperty("RECIBO_TEMPLATE_ID"), fid=_props().getProperty("RECIBOS_FOLDER_ID");
  if(!tid || !fid) return _jr({success:false, error:"Recibo não configurado (RECIBO_TEMPLATE_ID / RECIBOS_FOLDER_ID)."});
  var arr=_sbGet("vw_reembolsos?protocolo=eq."+encodeURIComponent(d.protocolo)+"&select=nome,cpf,rg,orgao,val_total,dist_total,checkin_foto,checkout_foto,cupom_foto", d.jwt);
  if(!arr || !arr.length) return _jr({success:false, error:"Protocolo não encontrado."});
  var r=arr[0];
  try{
    var folder=DriveApp.getFolderById(fid);
    var num=proximoNumeroRecibo();
    var nomeLimpo=String(r.nome||"Sem nome").replace(/[\\\/:*?"<>|]/g," ").replace(/\s+/g," ").trim();
    var nomeArq="Recibo "+num+" - "+nomeLimpo;
    var copia=DriveApp.getFileById(tid).makeCopy(nomeArq, folder);
    var doc=DocumentApp.openById(copia.getId()), body=doc.getBody();
    var valorFmt="R$ "+(Number(r.val_total)||0).toFixed(2).replace(".",",");
    var descricao="reembolso de deslocamento referente ao Protocolo "+d.protocolo+" ("+(r.dist_total||0)+" km)";
    body.replaceText("<<Nome_Completo>>", r.nome||"");
    body.replaceText("<<RG>>", r.rg||"—");
    body.replaceText("<<Orgao_Emissor>>", r.orgao||"");
    body.replaceText("<<CPF>>", r.cpf||"");
    body.replaceText("<<Valor_Total>>", valorFmt);
    body.replaceText("<<Valor_Extenso>>", valorPorExtenso(r.val_total));
    body.replaceText("<<Descricao_Pagamento>>", descricao);
    body.replaceText("<<Chave_Pix>>", r.cpf||"");
    body.replaceText("<<Data_Atual>>", dataPorExtenso(new Date()));
    body.replaceText("<<Nome_Assinatura>>", r.nome||"");
    body.replaceText("<<N_Recibo>>", num);
    var links=[r.checkin_foto,r.checkout_foto,r.cupom_foto].filter(function(x){return x;});
    body.replaceText("<<Link Imagem Autocrat>>", links.length?links.join("\n"):"—");
    doc.saveAndClose();
    var blob=copia.getAs("application/pdf").setName(nomeArq+".pdf");
    var pdf=folder.createFile(blob);
    pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    copia.setTrashed(true);
    var emails=_props().getProperty("EMAILS_RECIBO") || "lucas@rbcip.org,financeiro@rbcip.org,luiz.rocha@rbcip.org";
    if(emails) _enviarReciboInterno(emails, d, r, num, pdf, blob);
    return _jr({success:true, link:pdf.getUrl(), numero:num});
  }catch(err){ return _jr({success:false, error:"Falha no recibo: "+String(err && err.message || err)}); }
}

// ── Upload de imagem ao Drive (para o formulário do motorista) ──

// Faz um GET no PostgREST do Supabase usando o token do usuário (respeita a RLS)
function _sbGet(path, jwt){
  var url = _props().getProperty("SUPABASE_URL");
  var key = _props().getProperty("SUPABASE_PUBLISHABLE_KEY");
  var resp = UrlFetchApp.fetch(url + "/rest/v1/" + path, {
    method:"get",
    headers:{ "apikey": key, "Authorization":"Bearer " + jwt },
    muteHttpExceptions:true
  });
  if(resp.getResponseCode() !== 200) return null;
  try{ return JSON.parse(resp.getContentText()); }catch(_){ return null; }
}

// Extrai o id do usuário (claim "sub") de dentro do JWT (sem verificar assinatura —
// a verificação real é feita pelo Supabase quando usamos o token).
function _uidFromJwt(jwt){
  try{
    var parts = String(jwt||"").split(".");
    if(parts.length < 2) return null;
    var b64 = parts[1].replace(/-/g,"+").replace(/_/g,"/");
    while(b64.length % 4) b64 += "=";
    var json = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString();
    return JSON.parse(json).sub || null;
  }catch(e){ return null; }
}
// É admin? Confere o papel DO PRÓPRIO usuário do token (filtra o perfil pelo id).
// (Não dá para usar "perfis?select=papel" sem filtro: um admin enxerga TODOS os
//  perfis pela RLS, e a 1ª linha devolvida não é necessariamente a dele.)
function _ehAdmin(jwt){
  var uid = _uidFromJwt(jwt);
  if(!uid) return false;
  var perfil = _sbGet("perfis?select=papel&id=eq." + encodeURIComponent(uid), jwt);
  return !!(perfil && perfil.length && perfil[0].papel === "admin");
}

function enviarAvisoStatus(d){
  var jwt = d.jwt, protocolo = d.protocolo, novo = d.novo_status, obs = d.observacao || "";
  if(!jwt || !protocolo || !novo) return _jr({success:false, error:"Dados incompletos."});

  // COMPLETO não notifica (igual ao sistema atual)
  if(novo === "COMPLETO") return _jr({success:true, enviado:false, motivo:"COMPLETO não envia e-mail"});
  if(novo === "REJEITADO") novo = "REPROVADO";
  if(!EMAIL_STATUS[novo]) return _jr({success:false, error:"Status sem modelo de e-mail: " + novo});

  // 1) Confere que quem chamou é ADMIN (pelo id do próprio token)
  if(!_ehAdmin(jwt))
    return _jr({success:false, error:"Não autorizado (apenas admin)."});

  // 2) Busca o reembolso NO SUPABASE (destinatário nunca vem do navegador)
  var m = _dadosViagem(protocolo, jwt);
  if(!m) return _jr({success:false, error:"Protocolo não encontrado."});
  if(!m.email) return _jr({success:true, enviado:false, motivo:"Reembolso sem e-mail cadastrado"});

  // 3) Monta o e-mail (imagens embutidas: logo, ilustração e mapa do trajeto)
  var envio;
  try{
    var imgs = _imagensEmail(EMAIL_STATUS[novo].ilus, m);
    var em = _htmlAvisoStatus(m, novo, obs, imgs.src);
    envio = { to: m.email, subject: em.assunto, htmlBody: em.html, inlineImages: imgs.inline, name: "RBCIP · Reembolsos" };
  }catch(montErr){
    // plano B: se algo falhar ao montar o modelo, o aviso simples ainda é enviado
    var cfg = EMAIL_STATUS[novo];
    envio = { to: m.email, subject: cfg.assunto + protocolo, name: "RBCIP · Reembolsos",
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto"><h2 style="color:'+cfg.cor+'">'+_h(cfg.titulo(m.primeiroNome))+'</h2>'
        + '<p>'+_h(cfg.sub)+'</p><p>Protocolo: <b>'+_h(protocolo)+'</b> · '+_brl(m.total)+'</p>'
        + (obs?'<p><b>Observação:</b> '+_h(obs)+'</p>':'') + '<p>Dúvidas: '+CONTATO_BUSINESS+'</p></div>' };
  }
  try{
    MailApp.sendEmail(envio);
  }catch(mailErr){
    return _jr({success:false, error:"Falha ao enviar e-mail: " + String(mailErr && mailErr.message || mailErr)});
  }
  return _jr({success:true, enviado:true, para:m.email});
}

// ══════════════════════════════════════════════════════════════════════════
// E-MAILS NO ESTILO "RECIBO" (cabeçalho com logo + ilustração, total em
// destaque, detalhamento, linha do tempo da viagem e mapa do trajeto)
// ──────────────────────────────────────────────────────────────────────────
// Imagens: logo e ilustrações ficam no site (web/assets/email/*.png) e são
// EMBUTIDAS no e-mail (aparecem sem o leitor precisar "exibir imagens").
// O mapa é gerado pelo serviço de mapas do próprio Apps Script (sem chave).
// Propriedade opcional: SITE_URL (padrão https://reembolsosp.rbcip.org).
// ══════════════════════════════════════════════════════════════════════════
var TZ = "America/Sao_Paulo";
var COR = { marca:"#0B4F6C", marca2:"#14738F", turquesa:"#2BB6BA", texto:"#0F172A", texto2:"#475569", texto3:"#94A3B8",
            linha:"#E5E9F0", fundo:"#EEF3F6", cartao:"#F6F8FA" };
var FONTE = "'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

var EMAIL_STATUS = {
  "APROVADO":  { ilus:"aprovado",  rotulo:"Aprovado",            cor:"#2563EB", fundo:"#EFF6FF", etapa:2,
                 assunto:"Seu reembolso foi aprovado — ",
                 titulo:function(n){ return n+", seu reembolso foi aprovado"; },
                 sub:"Agora é só aguardar: o pagamento é feito em até 5 dias úteis.", totalRot:"Total aprovado" },
  "PAGO":      { ilus:"pago",      rotulo:"Pago",                cor:"#0D9488", fundo:"#F0FDFA", etapa:3,
                 assunto:"Recibo do seu reembolso — ",
                 titulo:function(n){ return n+", este é o recibo do seu reembolso"; },
                 sub:"O pagamento foi realizado. Obrigado pelo seu trabalho em campo!", totalRot:"Total pago" },
  "REVISÃO":   { ilus:"revisao",   rotulo:"Ajuste necessário",   cor:"#D97706", fundo:"#FFFBEB", etapa:1, ajuste:true,
                 assunto:"Sua solicitação precisa de um ajuste — ",
                 titulo:function(n){ return n+", sua solicitação precisa de um ajuste"; },
                 sub:"Faça a correção pelo sistema para seguirmos com a análise.", totalRot:"Total solicitado" },
  "REPROVADO": { ilus:"reprovado", rotulo:"Não aprovado",        cor:"#DC2626", fundo:"#FEF2F2", etapa:-1,
                 assunto:"Sua solicitação de reembolso não foi aprovada — ",
                 titulo:function(n){ return n+", sua solicitação não foi aprovada"; },
                 sub:"Veja abaixo o motivo informado pela equipe.", totalRot:"Total solicitado" }
};

// E-mail ao REGISTRAR a solicitação (enviado ao próprio pesquisador)
var EMAIL_REGISTRO = { ilus:"registro", rotulo:"Recebida", cor:"#14738F", fundo:"#ECF7F8", etapa:1,
  assunto:"Recebemos sua solicitação de reembolso — ",
  titulo:function(n){ return n+", recebemos sua solicitação"; },
  sub:"A equipe vai analisar em até 5 dias úteis. Você recebe um e-mail a cada atualização.", totalRot:"Total solicitado" };

function _site(){ return String(_props().getProperty("SITE_URL") || "https://reembolsosp.rbcip.org").replace(/\/+$/,""); }
function _h(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function _brl(v){ var n=Number(v)||0, neg=n<0; n=Math.abs(n); var p=n.toFixed(2).split("."); p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,".");
  return (neg?"-":"")+"R$ "+p[0]+","+p[1]; }
function _num(v,c){ return (Number(v)||0).toFixed(c==null?1:c).replace(".",",").replace(/,0+$/,""); }
function _fmtD(v, pat){ if(!v) return ""; var d=(v instanceof Date)?v:new Date(v); if(isNaN(d)) return ""; return Utilities.formatDate(d, TZ, pat); }
var _MESES=["jan.","fev.","mar.","abr.","mai.","jun.","jul.","ago.","set.","out.","nov.","dez."];
function _dataCurta(v){ var s=_fmtD(v,"d/M/yyyy"); if(!s) return ""; var p=s.split("/"); return p[0]+" de "+_MESES[Number(p[1])-1]+" de "+p[2]; }
function _primeiroNome(n){ var p=String(n||"").trim().split(/\s+/)[0]||""; return p ? p.charAt(0).toUpperCase()+p.slice(1).toLowerCase() : "Olá"; }
function _mascaraCpf(c){ var d=String(c||"").replace(/\D/g,""); return d.length===11 ? "***."+d.substr(3,3)+"."+d.substr(6,3)+"-**" : (c?"***":"—"); }
function _corta(s,n){ s=String(s||"").trim(); return s.length>n ? s.slice(0,n-1)+"…" : s; }

// ── Dados da solicitação + paradas, já no formato do e-mail ──
function _dadosViagem(protocolo, jwt){
  var arr=_sbGet("vw_reembolsos?protocolo=eq."+encodeURIComponent(protocolo)+"&select=id,protocolo,nome,email,cpf,rg,orgao,veiculo,placa,"
    +"checkin_em,checkout_em,checkin_lat,checkin_lng,checkout_lat,checkout_lng,dist_total,consumo,usou_estimativa,preco_base,preco_real,"
    +"val_real,val_pedagios,qtd_pedagios,val_total,aprovado_em,pago_em", jwt);
  if(!arr || !arr.length) return null;
  var r=arr[0], par=[];
  try{ par=_sbGet("paradas?reembolso_id=eq."+r.id+"&select=fase,ordem,origem,destino,km,horario,lat,lng&order=fase.asc,ordem.asc", jwt)||[]; }catch(e){ par=[]; }
  return _modeloViagem(r, par);
}
function _modeloViagem(r, par){
  var m={ protocolo:r.protocolo||"", nome:r.nome||"", primeiroNome:_primeiroNome(r.nome), email:r.email||"", cpf:r.cpf||"", rg:r.rg||"", orgao:r.orgao||"",
    veiculo:[r.veiculo,r.placa].filter(function(x){return x;}).join(" · "), km:Number(r.dist_total)||0,
    total:Number(r.val_total)||0, combustivel:Number(r.val_real!=null?r.val_real:r.val_total)||0,
    pedagios:Number(r.val_pedagios)||0, qtdPedagios:Number(r.qtd_pedagios)||0, pagoEm:r.pago_em||null, aprovadoEm:r.aprovado_em||null };
  var preco = r.usou_estimativa===false ? Number(r.preco_real||r.preco_base||0) : Number(r.preco_base||0);
  m.combDetalhe = (m.km && r.consumo && preco) ? (_num(m.km)+" km ÷ "+_num(r.consumo)+" km/L × "+_brl(preco)+"/L"+(r.usou_estimativa===false?" (cupom)":" (preço de referência)")) : "";
  // duração
  if(r.checkin_em && r.checkout_em){ var min=Math.round((new Date(r.checkout_em)-new Date(r.checkin_em))/60000);
    if(min>0 && min<72*60) m.duracao = (min>=60 ? Math.floor(min/60)+"h"+(min%60?" "+(min%60)+"min":"") : min+" min"); }
  // linha do tempo: início (check-in) → destinos das paradas → fim (check-out)
  var pts=[], coords=[];
  var ok=function(a,b){ return a!=null && b!=null && !isNaN(Number(a)) && !isNaN(Number(b)); };
  if(ok(r.checkin_lat,r.checkin_lng)) coords.push([Number(r.checkin_lat),Number(r.checkin_lng)]);
  pts.push({ hora:_fmtD(r.checkin_em,"HH:mm"), data:_fmtD(r.checkin_em,"dd/MM"), titulo:_corta((par[0]&&par[0].origem)||"Início da viagem (check-in)",90), sub:"" });
  var faseAnt="ida";
  (par||[]).forEach(function(p){
    var sub=[]; if(Number(p.km)) sub.push(_num(p.km)+" km"); if(p.fase==="volta" && faseAnt!=="volta") sub.unshift("Volta");
    faseAnt=p.fase;
    pts.push({ hora:_fmtD(p.horario,"HH:mm"), data:_fmtD(p.horario,"dd/MM"), titulo:_corta(p.destino||"Parada",90), sub:sub.join(" · ") });
    if(ok(p.lat,p.lng)) coords.push([Number(p.lat),Number(p.lng)]);
  });
  if(pts.length===1) pts.push({ hora:"", data:"", titulo:"Fim da viagem (check-out)", sub:"" });
  var ult=pts[pts.length-1];
  if(!ult.hora && r.checkout_em){ ult.hora=_fmtD(r.checkout_em,"HH:mm"); ult.data=_fmtD(r.checkout_em,"dd/MM"); }
  if(ok(r.checkout_lat,r.checkout_lng)) coords.push([Number(r.checkout_lat),Number(r.checkout_lng)]);
  // mostra a data só quando a viagem atravessa dias
  var dias={}; pts.forEach(function(x){ if(x.data) dias[x.data]=1; });
  m.dataViagem = _dataCurta(r.checkin_em);
  m.variosDias = Object.keys(dias).length>1;
  m.pontos=pts; m.coords=coords;
  m.mapaLink = coords.length ? "https://www.google.com/maps/dir/"+coords.map(function(c){return c[0]+","+c[1];}).join("/") : "";
  return m;
}

// ── Mapa do trajeto (PNG) — rota real quando possível, senão ligando os pontos ──
function _mapaBlob(m){
  var pts=(m.coords||[]).slice(0,25); if(!pts.length) return null;
  try{
    var map=Maps.newStaticMap().setSize(600,300).setMapType(Maps.StaticMap.Type.ROADMAP);
    try{ map.setLanguage("pt-BR"); }catch(e){}
    var poly=null;
    if(pts.length>=2){
      try{
        var df=Maps.newDirectionFinder().setOrigin(pts[0][0],pts[0][1]).setDestination(pts[pts.length-1][0],pts[pts.length-1][1]).setMode(Maps.DirectionFinder.Mode.DRIVING);
        for(var i=1;i<pts.length-1;i++) df.addWaypoint(pts[i][0],pts[i][1]);
        var dir=df.getDirections();
        if(dir && dir.routes && dir.routes.length && dir.routes[0].overview_polyline) poly=dir.routes[0].overview_polyline.points;
      }catch(e){ poly=null; }
      try{ map.setPathStyle(5, "0x0B4F6C", null); }catch(e){}
      if(poly) map.addPath(poly);
      else { map.beginPath(); pts.forEach(function(p){ map.addPoint(p[0],p[1]); }); map.endPath(); }
    }
    pts.forEach(function(p,i){
      var ini=(i===0), fim=(i===pts.length-1 && pts.length>1);
      try{ map.setMarkerStyle(ini||fim?Maps.StaticMap.MarkerSize.MID:Maps.StaticMap.MarkerSize.SMALL, ini?"0x16A34A":fim?"0x3A1D73":"0x14738F", ini?"A":fim?"B":null); }catch(e){}
      map.addMarker(p[0],p[1]);
    });
    return map.getBlob().setName("mapa.png");
  }catch(err){ return null; }
}

// ── Imagens embutidas (cid:...) com plano B pelo endereço público ──
function _buscaImg(caminho){
  try{ var r=UrlFetchApp.fetch(_site()+"/assets/email/"+caminho, {muteHttpExceptions:true});
    if(r.getResponseCode()===200) return r.getBlob().setName(caminho); }catch(e){}
  return null;
}
function _imagensEmail(ilus, m){
  var inline={}, src={}, b;
  b=_buscaImg("logo.png");    if(b){ inline.logo=b; src.logo="cid:logo"; } else src.logo=_site()+"/assets/email/logo.png";
  b=_buscaImg(ilus+".png");   if(b){ inline.ilus=b; src.ilus="cid:ilus"; } else src.ilus=_site()+"/assets/email/"+ilus+".png";
  b=_mapaBlob(m);             if(b){ inline.mapa=b; src.mapa="cid:mapa"; }
  return { inline:inline, src:src };
}

// ── Peças do layout (tabelas + estilos inline: funcionam no Gmail/Outlook) ──
function _linha(){ return '<tr><td style="padding:0"><div style="height:1px;background:'+COR.linha+';line-height:1px;font-size:0">&nbsp;</div></td></tr>'; }
function _secao(titulo){ return '<tr><td style="padding:26px 0 12px;font-family:'+FONTE+';font-size:19px;font-weight:700;color:'+COR.texto+'">'+titulo+'</td></tr>'; }
function _par(rot, val, opts){ opts=opts||{};
  return '<tr><td style="padding:'+(opts.pad||'9px 0')+'"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    +'<td style="font-family:'+FONTE+';font-size:'+(opts.fs||14)+'px;color:'+(opts.cor||COR.texto2)+';font-weight:'+(opts.peso||400)+';vertical-align:top">'+rot
    +(opts.sub?'<div style="font-size:12px;color:'+COR.texto3+';margin-top:3px;font-weight:400">'+opts.sub+'</div>':'')+'</td>'
    +'<td align="right" style="font-family:'+FONTE+';font-size:'+(opts.fs||14)+'px;color:'+(opts.corVal||COR.texto)+';font-weight:'+(opts.pesoVal||opts.peso||500)+';white-space:nowrap;vertical-align:top;padding-left:12px">'+val+'</td>'
    +'</tr></table></td></tr>'; }
function _botao(txt, href, cor, claro){
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" bgcolor="'+(claro?COR.cartao:cor)+'" style="border-radius:10px;'+(claro?'border:1px solid '+COR.linha+';':'')+'">'
    +'<a href="'+_h(href)+'" target="_blank" style="display:block;padding:13px 18px;font-family:'+FONTE+';font-size:14px;font-weight:600;color:'+(claro?cor:'#ffffff')+';text-decoration:none;border-radius:10px">'+txt+'</a></td></tr></table>'; }
function _cartao(conteudo){
  return '<tr><td style="padding:14px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid '+COR.linha+';border-radius:14px">'
    +'<tr><td style="padding:20px 22px">'+conteudo+'</td></tr></table></td></tr>'; }
function _aviso(cor, fundo, titulo, texto){
  return '<tr><td style="padding:22px 0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'+fundo+';border-left:4px solid '+cor+';border-radius:10px">'
    +'<tr><td style="padding:16px 18px;font-family:'+FONTE+'"><div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:'+cor+';margin-bottom:6px">'+titulo+'</div>'
    +'<div style="font-size:15px;line-height:1.5;color:'+COR.texto+'">'+texto+'</div></td></tr></table></td></tr>'; }
function _progresso(cfg){
  if(cfg.etapa<0) return "";
  var et=["Enviado","Em análise","Aprovado","Pago"]; if(cfg.ajuste) et[1]="Ajuste";
  var cel=et.map(function(t,i){
    var feito=i<cfg.etapa || (i===cfg.etapa && cfg.etapa===3), atual=(i===cfg.etapa);
    var c = atual ? cfg.cor : (feito ? COR.turquesa : "#DCE3EA");
    return '<td width="25%" style="padding:0 3px;vertical-align:top"><div style="height:6px;border-radius:3px;background:'+c+';line-height:6px;font-size:0">&nbsp;</div>'
      +'<div style="font-family:'+FONTE+';font-size:12px;padding-top:7px;color:'+(atual?cfg.cor:(feito?COR.texto2:COR.texto3))+';font-weight:'+(atual?700:500)+'">'+t+'</div></td>';
  }).join("");
  return '<tr><td style="padding:22px 0 2px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'+cel+'</tr></table></td></tr>';
}
function _blocoValores(m, rotTotal){
  var h=_par(rotTotal, _brl(m.total), {fs:24, peso:700, cor:COR.texto, corVal:COR.texto, pad:'24px 0 16px'})+_linha();
  h+=_par("Combustível", _brl(m.combustivel), {sub:m.combDetalhe, pad:'14px 0 8px'});
  if(m.pedagios || m.qtdPedagios) h+=_par("Pedágios"+(m.qtdPedagios?" ("+m.qtdPedagios+")":""), _brl(m.pedagios), {pad:'8px 0 14px'});
  return h+_linha();
}
function _blocoViagem(m, src){
  var h=_secao("Informações da viagem");
  h+='<tr><td style="padding:0 0 14px;font-family:'+FONTE+'"><div style="font-size:15px;color:'+COR.texto+';font-weight:600">'+_h(m.veiculo||"Deslocamento a campo")+'</div>'
    +'<div style="font-size:13px;color:'+COR.texto2+';margin-top:2px">'+[m.dataViagem, m.km?_num(m.km)+" km":"", m.duracao||""].filter(function(x){return x;}).join(" · ")+'</div></td></tr>';
  // Linha do tempo em tabela pura: marcador em cima e, abaixo, uma célula de 2px com
  // cor de fundo (estica até a próxima parada em qualquer leitor de e-mail).
  var n=m.pontos.length, linhas="";
  m.pontos.forEach(function(p,i){
    var ult=(i===n-1), mk = ult
      ? '<div style="width:11px;height:11px;background:'+COR.texto+';margin:4px auto 0;line-height:11px;font-size:0">&nbsp;</div>'
      : '<div style="width:8px;height:8px;border:3px solid '+(i===0?COR.texto:COR.marca2)+';border-radius:50%;background:#fff;margin:3px auto 0;line-height:8px;font-size:0">&nbsp;</div>';
    // linha 1: marcador + horário · linha 2: traço (célula de 2px) + endereço
    linhas+='<tr><td colspan="3" width="26" align="center" valign="top" style="padding:0">'+mk+'</td>'
      +'<td valign="top" style="padding:0 0 0 10px;font-family:'+FONTE+';font-size:14px;font-weight:700;color:'+COR.texto+'">'
      +(p.hora?p.hora+(m.variosDias&&p.data?' <span style="font-weight:500;color:'+COR.texto3+'">'+p.data+'</span>':''):'—')+'</td></tr>'
      +'<tr><td width="12" style="font-size:0;line-height:0">&nbsp;</td>'
      +'<td width="2"'+(ult?'':' bgcolor="#C9D3DD" style="background:#C9D3DD;font-size:0;line-height:0"')+'>&nbsp;</td>'
      +'<td width="12" style="font-size:0;line-height:0">&nbsp;</td>'
      +'<td valign="top" style="padding:2px 0 '+(ult?'4':'18')+'px 10px;font-family:'+FONTE+'">'
      +'<div style="font-size:13px;color:'+COR.texto2+';line-height:1.45">'+_h(p.titulo)+'</div>'
      +(p.sub?'<div style="font-size:12px;color:'+COR.texto3+';margin-top:2px">'+_h(p.sub)+'</div>':'')+'</td></tr>';
  });
  h+='<tr><td style="padding:4px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'+linhas+'</table></td></tr>';
  if(src.mapa) h+='<tr><td style="padding:6px 0 0">'+(m.mapaLink?'<a href="'+_h(m.mapaLink)+'" target="_blank">':'')
    +'<img src="'+src.mapa+'" width="536" alt="Mapa do trajeto" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px">'+(m.mapaLink?'</a>':'')+'</td></tr>';
  return h;
}
function _cartaoAjuda(){
  var wa="https://wa.me/"+CONTATO_BUSINESS.replace(/\D/g,"");
  return _cartao('<div style="font-family:'+FONTE+';font-size:18px;font-weight:700;color:'+COR.texto+'">Precisa de ajuda?</div>'
    +'<div style="font-family:'+FONTE+';font-size:14px;color:'+COR.texto2+';margin:6px 0 16px;line-height:1.5">Fale com a equipe de reembolsos pelo WhatsApp: <b style="color:'+COR.texto+'">'+CONTATO_BUSINESS+'</b></div>'
    +_botao("Falar no WhatsApp", wa, COR.marca, true));
}
function _layout(o){
  var agora=new Date();
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>'+_h(o.assunto)+'</title>'
  +'<style>@media only screen and (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.tit{font-size:24px!important}.ilus,.ilus img{width:96px!important}}</style></head>'
  +'<body style="margin:0;padding:0;background:#E9EEF2">'
  +'<div style="display:none;max-height:0;overflow:hidden;opacity:0">'+_h(o.preheader||"")+'</div>'
  +'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#E9EEF2"><tr><td align="center" style="padding:24px 10px">'
  +'<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">'
  // faixa com o degradê da marca
  +'<tr><td style="height:6px;line-height:6px;font-size:0;background:'+COR.turquesa+';background-image:linear-gradient(90deg,#36C9CB,#2F6C9E,#3A1D73)">&nbsp;</td></tr>'
  // cabeçalho
  +'<tr><td class="px" bgcolor="'+COR.fundo+'" style="padding:26px 32px 30px;background:'+COR.fundo+'">'
  +  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
  +    '<td style="vertical-align:middle"><img src="'+o.src.logo+'" width="120" height="48" alt="RBCIP" style="display:block;border:0;width:120px;height:48px"></td>'
  +    '<td align="right" style="vertical-align:middle;font-family:'+FONTE+';font-size:12px;color:'+COR.texto2+';line-height:1.4">'+_dataCurta(agora)+'<br>'+_fmtD(agora,"HH:mm")+'</td>'
  +  '</tr></table>'
  +  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr>'
  +    '<td style="vertical-align:middle;padding-right:10px;font-family:'+FONTE+'">'
  +      (o.pill?'<div style="display:inline-block;padding:5px 12px;border-radius:999px;background:#ffffff;color:'+o.pill.cor+';font-size:12px;font-weight:700;border:1px solid '+o.pill.cor+'">● '+_h(o.pill.txt)+'</div>':'')
  +      '<div class="tit" style="font-size:30px;line-height:1.18;font-weight:800;color:'+COR.texto+';margin-top:12px;letter-spacing:-.01em">'+_h(o.titulo)+'</div>'
  +      '<div style="font-size:15px;line-height:1.5;color:'+COR.texto2+';margin-top:12px">'+_h(o.sub)+'</div>'
  +    '</td>'
  +    '<td class="ilus" width="170" align="right" style="vertical-align:middle;width:170px"><img src="'+o.src.ilus+'" width="170" alt="" style="display:block;border:0;width:170px;max-width:100%;height:auto"></td>'
  +  '</tr></table>'
  +'</td></tr>'
  // corpo
  +'<tr><td class="px" style="padding:4px 32px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'+o.corpo+'</table></td></tr>'
  // rodapé
  +'<tr><td class="px" bgcolor="'+COR.cartao+'" style="padding:18px 32px;border-top:1px solid '+COR.linha+';font-family:'+FONTE+';font-size:12px;color:'+COR.texto3+';line-height:1.5">'
  +  'RBCIP · pesquisa e inovação — Reembolso de deslocamento<br>'+(o.rodape||'Este é um e-mail automático; para falar com a equipe, use o WhatsApp acima.')+'</td></tr>'
  +'</table></td></tr></table></body></html>';
}

// ── E-mail ao pesquisador quando o status muda ──
function _htmlAvisoStatus(m, novo, obs, src){
  var cfg=EMAIL_STATUS[novo], c="", obsH=_h(obs).replace(/\n/g,"<br>");
  if(novo==="REVISÃO"){
    c+=_aviso(cfg.cor, cfg.fundo, "O que precisa ser ajustado", obsH||"A equipe pediu um ajuste na sua solicitação.");
    c+=_cartao('<div style="font-family:'+FONTE+';font-size:16px;font-weight:700;color:'+COR.texto+';margin-bottom:10px">Como corrigir</div>'
      +'<div style="font-family:'+FONTE+';font-size:14px;color:'+COR.texto2+';line-height:1.7;margin-bottom:16px">'
      +'1. Acesse o sistema e entre com o seu e-mail.<br>2. Em <b>Viagens realizadas</b>, toque em <b>Corrigir</b> na solicitação em revisão.<br>3. Ajuste o que foi pedido e reenvie.</div>'
      +_botao("Corrigir minha solicitação", _site()+"/login.html", cfg.cor));
  } else if(novo==="REPROVADO"){
    c+=_aviso(cfg.cor, cfg.fundo, "Motivo", obsH||"Não informado.");
    c+='<tr><td style="padding:12px 0 0;font-family:'+FONTE+';font-size:14px;color:'+COR.texto2+';line-height:1.5">Se discordar da decisão, fale com a equipe pelo WhatsApp informado abaixo.</td></tr>';
  } else if(obsH){
    c+=_aviso(COR.marca, COR.cartao, "Observação da equipe", obsH);
  }
  c+=_progresso(cfg);
  c+=_par("Protocolo", '<span style="font-family:Consolas,Menlo,monospace">'+_h(m.protocolo)+'</span>', {pad:'22px 0 0', fs:13, cor:COR.texto3});
  c+=_blocoValores(m, cfg.totalRot);
  if(novo==="PAGO"){
    c+=_secao("Pagamento");
    c+='<tr><td style="padding:0 0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
      +'<td width="46" style="vertical-align:top"><div style="width:36px;height:36px;border-radius:9px;background:#E6F7F5;color:#0D9488;font-family:'+FONTE+';font-size:11px;font-weight:800;text-align:center;line-height:36px">PIX</div></td>'
      +'<td style="vertical-align:top;font-family:'+FONTE+'"><div style="font-size:14px;color:'+COR.texto+';font-weight:600">PIX · chave CPF <span style="white-space:nowrap">'+_mascaraCpf(m.cpf)+'</span></div>'
      +'<div style="font-size:12px;color:'+COR.texto3+';margin-top:3px">'+(m.pagoEm?_dataCurta(m.pagoEm)+" "+_fmtD(m.pagoEm,"HH:mm"):_dataCurta(new Date()))+'</div></td>'
      +'<td align="right" style="vertical-align:top;font-family:'+FONTE+';font-size:14px;font-weight:700;color:'+COR.texto+';white-space:nowrap">'+_brl(m.total)+'</td>'
      +'</tr></table></td></tr>'+_linha();
  }
  c+=_blocoViagem(m, src);
  if(novo!=="REVISÃO") c+=_cartao('<div style="font-family:'+FONTE+';font-size:16px;font-weight:700;color:'+COR.texto+'">Acompanhe suas solicitações</div>'
      +'<div style="font-family:'+FONTE+';font-size:14px;color:'+COR.texto2+';margin:6px 0 16px;line-height:1.5">Veja o histórico e o andamento de todas as suas viagens no sistema.</div>'
      +_botao("Acessar o sistema", _site()+"/login.html", COR.marca, true));
  c+=_cartaoAjuda();
  var assunto=cfg.assunto+m.protocolo;
  return { assunto:assunto, html:_layout({ assunto:assunto, src:src, pill:{txt:cfg.rotulo, cor:cfg.cor}, titulo:cfg.titulo(m.primeiroNome), sub:cfg.sub,
    preheader:cfg.sub+" Protocolo "+m.protocolo+" · "+_brl(m.total), corpo:c }) };
}

// ── E-mail de confirmação do registro ──
function _htmlRegistro(m, src){
  var cfg=EMAIL_REGISTRO, c="";
  c+=_progresso(cfg);
  c+=_par("Protocolo", '<span style="font-family:Consolas,Menlo,monospace">'+_h(m.protocolo)+'</span>', {pad:'22px 0 0', fs:13, cor:COR.texto3});
  c+=_blocoValores(m, cfg.totalRot);
  c+='<tr><td style="padding:12px 0 0;font-family:'+FONTE+';font-size:12px;color:'+COR.texto3+';line-height:1.5">O valor final é confirmado na análise da equipe.</td></tr>';
  c+=_blocoViagem(m, src);
  c+=_cartao('<div style="font-family:'+FONTE+';font-size:16px;font-weight:700;color:'+COR.texto+'">Acompanhe sua solicitação</div>'
      +'<div style="font-family:'+FONTE+';font-size:14px;color:'+COR.texto2+';margin:6px 0 16px;line-height:1.5">Veja o andamento e o histórico das suas viagens no sistema.</div>'
      +_botao("Acessar o sistema", _site()+"/login.html", COR.marca, true));
  c+=_cartaoAjuda();
  var assunto=cfg.assunto+m.protocolo;
  return { assunto:assunto, html:_layout({ assunto:assunto, src:src, pill:{txt:cfg.rotulo, cor:cfg.cor}, titulo:cfg.titulo(m.primeiroNome), sub:cfg.sub,
    preheader:"Protocolo "+m.protocolo+" · "+_brl(m.total)+". "+cfg.sub, corpo:c }) };
}

// ── E-mail interno (financeiro) com o recibo em PDF anexo ──
function _htmlReciboInterno(m, numero, pdfUrl, src){
  var c="";
  c+='<tr><td style="padding:22px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    +'<td width="50%" style="padding-right:6px">'+_botao("Abrir recibo (PDF)", pdfUrl, COR.marca)+'</td>'
    +'<td width="50%" style="padding-left:6px">'+_botao("Ver no painel", _site()+"/painel.html", COR.marca, true)+'</td></tr></table></td></tr>';
  c+=_blocoValores(m, "Valor do recibo");
  c+=_secao("Dados do beneficiário");
  c+=_par("Nome", _h(m.nome||"—"), {pad:'6px 0'});
  c+=_par("CPF / chave PIX", _h(m.cpf||"—"), {pad:'6px 0'});
  if(m.rg) c+=_par("RG", _h(m.rg+(m.orgao?" "+m.orgao:"")), {pad:'6px 0'});
  c+=_par("Protocolo", '<span style="font-family:Consolas,Menlo,monospace">'+_h(m.protocolo)+'</span>', {pad:'6px 0 14px'});
  c+=_linha();
  c+=_blocoViagem(m, src);
  var assunto="Recibo Nº "+numero+" — "+m.nome;
  return { assunto:assunto, html:_layout({ assunto:assunto, src:src, pill:{txt:"Recibo gerado", cor:COR.marca}, titulo:"Recibo Nº "+numero,
    sub:(m.nome||"")+" · "+m.protocolo+". O PDF segue em anexo.", preheader:"Recibo Nº "+numero+" · "+(m.nome||"")+" · "+_brl(m.total), corpo:c,
    rodape:"E-mail interno da equipe de reembolsos (financeiro)." }) };
}
function _enviarReciboInterno(emails, d, r, num, pdf, blob){
  var numero=num+"/"+new Date().getFullYear();
  try{
    var mi=_dadosViagem(d.protocolo, d.jwt) || _modeloViagem({protocolo:d.protocolo, nome:r.nome, cpf:r.cpf, rg:r.rg, orgao:r.orgao, val_total:r.val_total, dist_total:r.dist_total}, []);
    var im=_imagensEmail("recibo", mi), em=_htmlReciboInterno(mi, numero, pdf.getUrl(), im.src);
    MailApp.sendEmail({ to:emails, subject:"Recibo de reembolso Nº "+num+" — "+(r.nome||"")+" ("+d.protocolo+")", htmlBody:em.html,
      inlineImages:im.inline, attachments:[blob], name:"RBCIP · Reembolsos" });
  }catch(e){
    // plano B: e-mail simples (o PDF nunca deixa de chegar ao financeiro)
    try{ MailApp.sendEmail({ to:emails, subject:"Recibo de reembolso Nº "+num+" — "+(r.nome||"")+" ("+d.protocolo+")",
      htmlBody:'<p>Recibo Nº '+numero+' — '+_h(r.nome||"")+' ('+_h(d.protocolo)+') — '+_brl(r.val_total)+'.</p><p><a href="'+pdf.getUrl()+'">Abrir no Drive</a></p>',
      attachments:[blob] }); }catch(e2){}
  }
}

// ── TESTE: rode no editor (▶ Executar → enviarPreviaEmails) para receber no SEU
// e-mail o de registro, os 4 avisos de status e o e-mail interno, com dados FICTÍCIOS e o mapa
// real do Google. Não toca no Supabase nem envia nada a pesquisadores.
function enviarPreviaEmails(){
  var eu=Session.getActiveUser().getEmail(); if(!eu) throw new Error("Não consegui identificar seu e-mail.");
  var r={protocolo:"RB-TESTE001",nome:"Maria Fernanda Souza",cpf:"123.456.789-09",rg:"12.345.678-9",orgao:"SSP/SP",veiculo:"Fiat Argo",placa:"ABC1D23",
    checkin_em:"2026-11-10T11:02:00Z",checkout_em:"2026-11-10T17:48:00Z",checkin_lat:-23.5703,checkin_lng:-46.6398,checkout_lat:-23.5703,checkout_lng:-46.6398,
    dist_total:142.6,consumo:10,usou_estimativa:true,preco_base:6.12,val_real:87.27,val_pedagios:24.6,qtd_pedagios:2,val_total:111.87,pago_em:new Date().toISOString()};
  var par=[{fase:"ida",origem:"Rua Vergueiro, 1000 - Liberdade, São Paulo - SP",destino:"Centro de Jundiaí - SP",km:58.3,horario:"2026-11-10T12:10:00Z",lat:-23.1857,lng:-46.8978},
    {fase:"ida",origem:"Centro de Jundiaí - SP",destino:"Vila Rami, Jundiaí - SP",km:6.2,horario:"2026-11-10T14:35:00Z",lat:-23.2017,lng:-46.9116},
    {fase:"volta",origem:"Vila Rami, Jundiaí - SP",destino:"Rua Vergueiro, 1000 - Liberdade, São Paulo - SP",km:78.1,horario:null,lat:-23.5703,lng:-46.6398}];
  var m=_modeloViagem(r,par);
  var obs={"REVISÃO":"O comprovante do pedágio da volta está ilegível. Envie uma foto nítida, por favor.","REPROVADO":"Viagem fora do período do projeto."};
  ["APROVADO","PAGO","REVISÃO","REPROVADO"].forEach(function(st){
    var im=_imagensEmail(EMAIL_STATUS[st].ilus, m), em=_htmlAvisoStatus(m, st, obs[st]||"", im.src);
    MailApp.sendEmail({to:eu, subject:"[TESTE] "+em.assunto, htmlBody:em.html, inlineImages:im.inline, name:"RBCIP · Reembolsos"});
  });
  var imR=_imagensEmail(EMAIL_REGISTRO.ilus, m), emR=_htmlRegistro(m, imR.src);
  MailApp.sendEmail({to:eu, subject:"[TESTE] "+emR.assunto, htmlBody:emR.html, inlineImages:imR.inline, name:"RBCIP · Reembolsos"});
  var imI=_imagensEmail("recibo", m), emI=_htmlReciboInterno(m, "000/"+new Date().getFullYear(), "https://drive.google.com", imI.src);
  MailApp.sendEmail({to:eu, subject:"[TESTE] "+emI.assunto, htmlBody:emI.html, inlineImages:imI.inline, name:"RBCIP · Reembolsos"});
  return "6 e-mails de teste enviados para "+eu+(imI.inline.mapa?" (com mapa)":" (SEM mapa — confira o serviço de mapas)");
}
