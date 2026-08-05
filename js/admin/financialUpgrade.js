function organizeMenu(){
  const sidebar=document.querySelector(".sidebar");
  if(!sidebar||document.querySelector(".sidebar-nav"))return;
  const nav=document.createElement("nav");
  nav.className="sidebar-nav";
  const dashboard=sidebar.querySelector('[onclick*="dashboard"]');
  if(dashboard)nav.append(dashboard);
  const groups=[
    ["Pedidos",["central","encomendas","festas"],true],
    ["Operacao",["venda","caixa"],true],
    ["Catalogo",["produtos","categorias","promocoes"],false],
    ["Gestao e sistema",["financeiro","backup","config"],false]
  ];
  groups.forEach(([title,names,open])=>{
    const group=document.createElement("details");
    group.className="nav-group";
    group.open=open;
    if(title==="Operacao")group.id="menu-operacao";if(title==="Gestao e sistema")group.id="menu-gestao";
    const summary=document.createElement("summary");
    summary.textContent=title;
    group.append(summary);
    names.forEach(name=>{
      const button=[...sidebar.querySelectorAll(".tab-btn")].find(item=>item.getAttribute("onclick")?.includes("'"+name+"'"));
      if(button)group.append(button);
    });
    nav.append(group);
  });
  const site=sidebar.querySelector(".site-link");
  sidebar.insertBefore(nav,site||null);
  document.head.insertAdjacentHTML("beforeend",'<style>.sidebar{overflow-y:auto}.sidebar-nav{display:grid;gap:8px;flex:1;overflow:auto}.nav-group{border:1px solid rgba(255,255,255,.15);border-radius:14px;overflow:hidden}.nav-group summary{list-style:none;padding:10px 12px;color:#ffe8c7;font-size:.78rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}.nav-group summary::-webkit-details-marker{display:none}.nav-group summary:after{content:"+";float:right}.nav-group[open] summary:after{content:"-"} .nav-group .tab-btn{width:100%;border-radius:0;padding:10px 13px}@media(max-width:850px){.sidebar-nav{max-height:none}}</style>');
}

import{db,collection,doc,setDoc,updateDoc,addDoc,onSnapshot,serverTimestamp,runTransaction}from"../core/firebase.js";
import{toCents,fromCents,calculateChangeCents,calculateExpectedCashCents,calculateCashDifferenceCents}from"../services/financialCore.js";

const R=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const D=()=>new Date().toISOString().slice(0,10);
const S={p:[],v:[],m:[],c:[],r:[],cart:[],busy:false,view:"d"};
const esc=v=>String(v??"").replace(/[&<>]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[x]));
const css=".finance-pro-nav{display:flex;gap:8px;overflow:auto;margin-bottom:16px}.finance-pro-nav button,.pro-product,.pro-cart button{border:1px solid #dfc9aa;background:#fff9ee;border-radius:10px;padding:10px;color:#52351e}.finance-pro-nav .active,.pro-primary{background:#5b3a21!important;color:#fff!important}.pro-grid,.pro-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.pro-products{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:9px}.pro-product{display:grid;text-align:left;gap:3px}.pro-cart-row,.pro-sale{display:flex;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #eee0cc}.pro-cart-row button{padding:3px 9px}.pro-total{display:flex;justify-content:space-between;padding:14px;background:#f7eddf;margin:12px 0;font-size:20px}.pro-form label{display:grid;gap:5px;margin:9px 0}.pro-form input,.pro-form select{padding:10px;border:1px solid #dec9ad;border-radius:8px}.pro-cards>div{padding:14px;border-radius:12px;background:#fff8ed}.pro-cards strong{display:block;font-size:21px}.pro-tag{font-size:12px;padding:3px 7px;border-radius:99px;background:#fff0bd}.pro-sale button{margin-top:8px}@media(max-width:720px){.pro-grid,.pro-cards{grid-template-columns:1fr}}";

function page(){organizeMenu();
  if(document.getElementById("aba-financeiro-pro"))return;
  document.head.insertAdjacentHTML("beforeend","<style>"+css+"</style>");
  const b=document.createElement("button");
  b.className="tab-btn";
  b.textContent="Gestao financeira";
  const menu=document.getElementById("menu-gestao");
  if(menu)menu.append(b);else document.querySelector(".sidebar")?.append(b);
  const a=document.createElement("section");
  a.id="aba-financeiro-pro";
  a.className="aba";
  a.innerHTML='<div class="panel-head"><div><p class="eyebrow">Financeiro</p><h2>Gestao financeira</h2><p>Resumo, caixa, despesas e pendencias.</p></div></div><div class="finance-pro-nav"><button class="active" data-x="d">Resumo</button><button data-x="c">Caixa</button><button data-x="h">Historico</button><button data-x="r">A receber</button><button data-x="m">Lancamento</button></div><div id="pro"></div>';
  document.querySelector(".content")?.append(a);
  b.onclick=()=>{
    document.querySelectorAll(".aba,.tab-btn").forEach(x=>x.classList.remove("active"));
    a.classList.add("active");b.classList.add("active");
    document.getElementById("tituloAba").textContent="Gestao financeira";
        render("d");
  };
  a.querySelector(".finance-pro-nav").onclick=e=>{
    const q=e.target.closest("[data-x]");
    if(!q)return;
    a.querySelectorAll("[data-x]").forEach(x=>x.classList.toggle("active",x===q));
    render(q.dataset.x);
  };
}

const sales=()=>S.v.filter(x=>x.status!=="cancelada"&&x.statusPagamento!=="pendente");
const sum=(items,key="total")=>items.reduce((total,item)=>total+Number(item[key]||0),0);
const cartTotal=()=>S.cart.reduce((total,item)=>total+item.preco*item.quantidade,0);
const session=()=>S.c.find(x=>x.dataISO===D());
const num=value=>Number(String(value||"").replace(/\./g,"").replace(",","."))||0;

function render(view=S.view){
  S.view=view;
  const out=document.getElementById("pro");
  if(!out)return;

  if(view==="v"){
    out.innerHTML='<div class="pro-grid"><article class="panel"><h3>Produtos</h3><input class="input-full" id="ps" placeholder="Buscar produto"><div id="pp" class="pro-products">'+products(S.p)+'</div></article><article class="panel pro-form"><h3>Pedido</h3><div id="pc">'+cartRows()+'</div><div class="pro-total"><span>Total</span><b>'+R(cartTotal())+'</b></div><label>Pagamento<select id="pay"><option>Pix</option><option>Dinheiro</option><option>Cartao debito</option><option>Cartao credito</option><option>Pendente</option></select></label><label id="rec" hidden>Valor recebido<input id="got" inputmode="decimal"></label><p id="chg"></p><label>Cliente (opcional)<input id="cli"></label><label>Observacao<input id="note"></label><button id="finish" class="primary-btn pro-primary" '+(!S.cart.length?"disabled":"")+'>Finalizar venda</button></article></div>';
  }
  if(view==="d"){
    const today=sales().filter(x=>x.dataISO===D());
    const expenses=S.m.filter(x=>x.tipo==="saida"&&x.dataISO===D());
    out.innerHTML='<div class="pro-cards"><div>Vendas hoje<strong>'+R(sum(today))+'</strong>'+today.length+' venda(s)</div><div>Despesas hoje<strong>'+R(sum(expenses,"valor"))+'</strong>Resultado '+R(sum(today)-sum(expenses,"valor"))+'</div><div>Em aberto<strong>'+R(sum(S.r.filter(x=>x.status!=="pago"&&x.status!=="cancelada"),"saldo"))+'</strong>'+S.r.filter(x=>x.status!=="pago"&&x.status!=="cancelada").length+' pendencia(s)</div><div>Ticket medio<strong>'+R(today.length?sum(today)/today.length:0)+'</strong>Vendas nao canceladas</div></div>';
  }
  if(view==="c"){
    const current=session();
    if(!current)out.innerHTML='<article class="panel pro-form"><h3>Abrir caixa</h3><label>Valor inicial<input id="open" inputmode="decimal"></label><button id="openb" class="primary-btn">Abrir caixa</button></article>';
    else{
      const totals=cash(current);
      out.innerHTML='<div class="pro-cards"><div>Inicial<strong>'+R(current.valorInicial)+'</strong></div><div>Esperado em dinheiro<strong>'+R(totals.expect)+'</strong></div><div>Vendas em dinheiro<strong>'+R(totals.cash)+'</strong></div><div>Resultado do dia<strong>'+R(totals.sales-totals.expenses)+'</strong></div></div>'+(current.status==="fechado"?'<article class="panel"><h3>Caixa fechado</h3><p>Contado: '+R(current.valorContado)+" | Diferenca: "+R(current.diferenca)+'</p></article>':'<article class="panel pro-form"><h3>Fechar caixa</h3><label>Valor contado<input id="count" inputmode="decimal"></label><button id="close" class="primary-btn">Fechar caixa</button></article>');
    }
  }
  if(view==="h"){
    const rows=[...S.v].sort((a,b)=>(b.criadoEm?.seconds||0)-(a.criadoEm?.seconds||0));
    out.innerHTML='<article class="panel"><div class="panel-title"><h3>Historico</h3><button data-export="v">Exportar CSV</button></div><label>Filtrar status<select id="historyStatus"><option value="todos">Todos</option><option value="concluida">Concluidas</option><option value="pendente">Pendentes</option><option value="cancelada">Canceladas</option></select></label>'+rows.map(sale=>'<div class="pro-sale" data-status="'+(sale.status==="cancelada"?"cancelada":sale.statusPagamento==="pendente"?"pendente":"concluida")+'"><span><b>'+esc(sale.numero||sale.id.slice(-6))+'</b><br><small>'+esc(sale.dataISO)+" | "+esc(sale.pagamento)+'</small><br>'+((sale.itens||[]).map(item=>item.quantidade+"x "+esc(item.nome)).join(", "))+'</span><span><b>'+R(sale.total)+'</b><br><em class="pro-tag">'+(sale.status==="cancelada"?"Cancelada":sale.statusPagamento==="pendente"?"Pendente":"Concluida")+'</em>'+(sale.status!=="cancelada"?'<br><button data-cancel="'+sale.id+'">Cancelar e devolver estoque</button>':"")+'</span></div>').join("")+"</article>";
  }
  if(view==="r"){
    const rows=S.r.filter(item=>item.status!=="cancelada");
    out.innerHTML='<article class="panel"><h3>Contas a receber</h3>'+rows.map(item=>'<div class="pro-sale"><span><b>'+esc(item.cliente||"Cliente nao informado")+'</b><br><small>'+esc(item.dataVenda||"")+'</small></span><span><b>'+R(item.saldo)+'</b><br><em class="pro-tag">'+esc(item.status)+'</em>'+(item.status!=="pago"?'<br><button data-receive="'+item.id+'">Receber</button>':"")+'</span></div>').join("")+"</article>";
  }
  if(view==="m"){
    out.innerHTML='<article class="panel pro-form"><h3>Novo lancamento</h3><label>Tipo<select id="mt"><option value="saida">Despesa</option><option value="entrada">Entrada manual</option><option value="retirada">Retirada</option></select></label><label>Descricao<input id="md"></label><label>Categoria<input id="mc" value="Outras despesas"></label><label>Valor<input id="ma" inputmode="decimal"></label><label>Pagamento<select id="mp"><option>Pix</option><option>Dinheiro</option><option>Cartao debito</option><option>Cartao credito</option></select></label><button id="save" class="primary-btn">Salvar</button></article>';
  }
  bind(view,out);
}

function products(items){
  return items.filter(item=>item.ativo!==false&&!item.sobEncomenda&&Number(item.estoque||0)>0).map(item=>'<button class="pro-product" data-add="'+item.id+'"><b>'+esc(item.nome)+'</b><small>'+R(item.preco)+" | Estoque: "+Number(item.estoque||0)+'</small></button>').join("")||"Nenhum produto disponivel.";
}
function cartRows(){
  return S.cart.map(item=>'<div class="pro-cart-row"><span>'+esc(item.nome)+" x "+item.quantidade+'</span><span><button data-q="'+item.id+'" data-n="-1">-</button> <button data-q="'+item.id+'" data-n="1">+</button> <b>'+R(item.preco*item.quantidade)+'</b></span></div>').join("")||"Pedido vazio.";
}
function exportHistory(){
  const rows=["Numero;Data;Pagamento;Status;Total",...S.v.map(sale=>[sale.numero||sale.id,sale.dataISO,sale.pagamento,sale.status==="cancelada"?"Cancelada":sale.statusPagamento==="pendente"?"Pendente":"Concluida",Number(sale.total||0).toFixed(2).replace(".",",")].join(";"))];
  const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv;charset=utf-8"}));link.download="historico-financeiro-"+D()+".csv";link.click();URL.revokeObjectURL(link.href);
}
function bind(view,out){
  if(view==="v"){
    out.onclick=e=>{
      const add=e.target.closest("[data-add]")?.dataset.add;
      const quantity=e.target.closest("[data-q]");
      if(add){
        const product=S.p.find(item=>item.id===add);
        const item=S.cart.find(productItem=>productItem.id===add);
        if(item){if(item.quantidade>=Number(product.estoque||0))return alert("Quantidade maxima em estoque.");item.quantidade++;}
        else S.cart.push({id:product.id,nome:product.nome,preco:Number(product.preco),quantidade:1});
        render("v");
      }
      if(quantity){
        const item=S.cart.find(productItem=>productItem.id===quantity.dataset.q);
        const product=S.p.find(productItem=>productItem.id===item.id);
const next=item.quantidade+Number(quantity.dataset.n);
if(next>Number(product?.estoque||0))return alert("Quantidade maxima em estoque.");
item.quantidade=next;
        if(item.quantidade<1)S.cart=S.cart.filter(productItem=>productItem!==item);
        render("v");
      }
    };
    out.querySelector("#ps").oninput=e=>{document.getElementById("pp").innerHTML=products(S.p.filter(item=>item.nome.toLowerCase().includes(e.target.value.toLowerCase().trim())));};
out.querySelector("#pay").onchange=e=>out.querySelector("#rec").hidden=e.target.value!=="Dinheiro";
    out.querySelector("#got").oninput=()=>{
      const received=num(out.querySelector("#got").value);
      const total=cartTotal();
      out.querySelector("#chg").textContent=received>=total?"Troco: "+R(received-total):"Faltam "+R(total-received);
    };
    out.querySelector("#finish").onclick=finish;
  }
  if(view==="c"){
    out.querySelector("#openb")?.addEventListener("click",openCash);
    out.querySelector("#close")?.addEventListener("click",closeCash);
  }
  if(view==="h"){
out.onchange=e=>{if(e.target.id==="historyStatus"){const status=e.target.value;out.querySelectorAll(".pro-sale").forEach(row=>row.hidden=status!=="todos"&&row.dataset.status!==status);}};
out.querySelector("[data-export]").onclick=exportHistory;
out.onclick=e=>{
    const id=e.target.closest("[data-cancel]")?.dataset.cancel;
    if(id)cancel(id);
  };
  }
if(view==="r")out.onclick=e=>{
    const id=e.target.closest("[data-receive]")?.dataset.receive;
    if(id)receive(id);
  };
  if(view==="m")out.querySelector("#save").onclick=movement;
}

async function changeStock(transaction,items,direction){
  const refs=items.map(item=>doc(db,"produtos",item.id));
  const snapshots=await Promise.all(refs.map(ref=>transaction.get(ref)));
  snapshots.forEach((snapshot,index)=>{
    if(!snapshot.exists())return;
    const item=items[index];
    const data=snapshot.data();
    const quantity=Number(item.quantidade||0);
    if(!quantity||data.sobEncomenda)return;
    if(item.variacaoId){
      const variations=Array.isArray(data.variacoes)?data.variacoes:[];
      const variationIndex=variations.findIndex(variation=>variation.id===item.variacaoId);
      if(variationIndex<0)return;
      const current=Number(variations[variationIndex].estoque||0);
      const next=current+direction*quantity;
      if(next<0)throw new Error("Estoque insuficiente para "+item.nome);
      transaction.update(snapshot.ref,{["variacoes."+variationIndex+".estoque"]:next,atualizadoEm:serverTimestamp()});
      return;
    }
    const current=Number(data.estoque||0);
    const next=current+direction*quantity;
    if(next<0)throw new Error("Estoque insuficiente para "+item.nome);
    transaction.update(snapshot.ref,{estoque:next,atualizadoEm:serverTimestamp()});
  });
}

async function finish(){
  if(S.busy)return;
  const payment=document.getElementById("pay").value;
  const total=cartTotal();
  const received=num(document.getElementById("got").value);
  if(payment==="Dinheiro"&&received<total)return alert("Informe o valor recebido.");
  S.busy=true;
  try{
    const saleRef=doc(collection(db,"vendas"));
    const pending=payment==="Pendente";
    const items=S.cart.map(item=>({...item,precoUnitarioCentavos:toCents(item.preco),subtotal:item.preco*item.quantidade}));
    await runTransaction(db,async transaction=>{
      await changeStock(transaction,items,-1);
      transaction.set(saleRef,{
        tipo:"fisica",numero:"VD-"+Date.now().toString().slice(-6),itens,total,totalCentavos:toCents(total),pagamento:payment,statusPagamento:pending?"pendente":"pago",valorRecebido:payment==="Dinheiro"?received:total,troco:payment==="Dinheiro"?received-total:0,cliente:document.getElementById("cli").value.trim(),observacao:document.getElementById("note").value.trim(),status:"concluida",dataISO:D(),hora:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),criadoEm:serverTimestamp(),atualizadoEm:serverTimestamp()
      });
    });
    if(pending)await addDoc(collection(db,"contasReceber"),{vendaId:saleRef.id,cliente:document.getElementById("cli").value.trim(),total,pago:0,saldo:total,status:"pendente",dataVenda:D(),pagamentos:[],criadoEm:serverTimestamp(),atualizadoEm:serverTimestamp()});
    S.cart=[];
    alert(pending?"Venda pendente registrada.":"Venda registrada e estoque atualizado.");
    render("v");
  }catch(error){
    console.error(error);
    alert(error.message||"Nao foi possivel salvar. Confira as regras do Firestore.");
  }finally{S.busy=false;}
}

function valorPorPagamento(registro,tipo,campoTotal="total"){
  const detalhes=Array.isArray(registro.pagamentos)?registro.pagamentos:[];
  if(detalhes.length){
    return detalhes.reduce((total,item)=>total+((item.tipo||"")===tipo?Number(item.valor||0):0),0);
  }
  return registro.pagamento===tipo?Number(registro[campoTotal]||registro.valor||0):0;
}
function resumoPagamentosRegistros(registros,campoTotal="total"){
  const resumo={};
  registros.forEach(registro=>{
    const detalhes=Array.isArray(registro.pagamentos)?registro.pagamentos:[];
    if(detalhes.length){
      detalhes.forEach(item=>{
        const tipo=item.tipo||"Não informado";
        resumo[tipo]=(resumo[tipo]||0)+Number(item.valor||0);
      });
    }else{
      const tipo=registro.pagamento||"Não informado";
      resumo[tipo]=(resumo[tipo]||0)+Number(registro[campoTotal]||registro.valor||0);
    }
  });
  return resumo;
}
function cash(current){
  const today=sales().filter(item=>item.dataISO===D());
  const movements=S.m.filter(item=>item.dataISO===D());
  const cashSales=today.reduce((total,item)=>total+valorPorPagamento(item,"Dinheiro","total"),0);
  const income=movements.filter(item=>item.tipo==="entrada").reduce((total,item)=>total+valorPorPagamento(item,"Dinheiro","valor"),0);
  const expenses=movements.filter(item=>item.tipo==="saida").reduce((total,item)=>total+valorPorPagamento(item,"Dinheiro","valor"),0);
  const withdrawals=sum(movements.filter(item=>item.tipo==="retirada"),"valor");
  const expected=fromCents(calculateExpectedCashCents({openingBalanceCents:toCents(current.valorInicial),cashSalesCents:toCents(cashSales),cashIncomeCents:toCents(income),cashExpensesCents:toCents(expenses),cashWithdrawalsCents:toCents(withdrawals)}));
  return{cash:cashSales,expect:expected,sales:sum(today),expenses:sum(movements.filter(item=>item.tipo==="saida"),"valor"),pagamentosVendas:resumoPagamentosRegistros(today,"total"),pagamentosEntradas:resumoPagamentosRegistros(movements.filter(item=>item.tipo==="entrada"),"valor"),pagamentosSaidas:resumoPagamentosRegistros(movements.filter(item=>item.tipo==="saida"),"valor")};
}
async function openCash(){
  const value=num(document.getElementById("open").value);
  await setDoc(doc(db,"sessoesCaixa",D()),{dataISO:D(),valorInicial:value,status:"aberto",abertoEm:serverTimestamp()});
}
async function closeCash(){
  const current=session(),value=num(document.getElementById("count").value);
  if(!confirm("Fechar o caixa do dia?"))return;
  const resumo=cash(current);
  const difference=fromCents(calculateCashDifferenceCents(toCents(resumo.expect),toCents(value)));
  await updateDoc(doc(db,"sessoesCaixa",current.id),{
    status:"fechado",
    valorContado:value,
    valorEsperado:resumo.expect,
    diferenca: difference,
    totalVendas:resumo.sales,
    totalDespesas:resumo.expenses,
    pagamentosVendas:resumo.pagamentosVendas,
    pagamentosEntradas:resumo.pagamentosEntradas,
    pagamentosSaidas:resumo.pagamentosSaidas,
    fechadoEm:serverTimestamp()
  });
}
async function cancel(id){
  const receivable=S.r.find(item=>item.vendaId===id);
  if(!confirm("Cancelar esta venda? O estoque sera devolvido e o financeiro sera ajustado."))return;
  try{
    await runTransaction(db,async transaction=>{
      const saleRef=doc(db,"vendas",id);
      const snapshot=await transaction.get(saleRef);
      if(!snapshot.exists())throw new Error("Venda nao encontrada.");
      const sale=snapshot.data();
      if(sale.status==="cancelada")throw new Error("Esta venda ja foi cancelada.");
      await changeStock(transaction,sale.itens||[],1);
      transaction.update(saleRef,{status:"cancelada",canceladaEm:serverTimestamp(),motivoCancelamento:"Cancelada pelo painel",atualizadoEm:serverTimestamp()});
      if(receivable)transaction.update(doc(db,"contasReceber",receivable.id),{status:"cancelada",saldo:0,canceladaEm:serverTimestamp(),atualizadoEm:serverTimestamp()});
    });
    alert("Venda cancelada. Estoque e financeiro foram ajustados.");
  }catch(error){
    console.error(error);
    alert(error.message||"Nao foi possivel cancelar a venda.");
  }
}
async function receive(id){
  const item=S.r.find(row=>row.id===id);
  const value=num(prompt("Valor recebido:",item.saldo));
  if(!value||value>item.saldo)return;
  const paid=Number(item.pago||0)+value;
  const balance=item.total-paid;
  await updateDoc(doc(db,"contasReceber",id),{pago:paid,saldo:balance,status:balance?"parcialmente_pago":"pago",atualizadoEm:serverTimestamp()});
  await addDoc(collection(db,"movimentosFinanceiros"),{tipo:"entrada",descricao:"Recebimento de pendencia",categoria:"Contas a receber",valor:value,pagamento:"Pix",dataISO:D(),criadoEm:serverTimestamp()});
}
async function movement(){
  const value=num(document.getElementById("ma").value);
  const description=document.getElementById("md").value.trim();
  if(!value||!description)return alert("Informe descricao e valor.");
  await addDoc(collection(db,"movimentosFinanceiros"),{tipo:document.getElementById("mt").value,descricao:description,categoria:document.getElementById("mc").value,valor:value,pagamento:document.getElementById("mp").value,dataISO:D(),criadoEm:serverTimestamp()});
  alert("Lancamento salvo.");
  render("m");
}
function rerenderActive(){
  if(document.getElementById("aba-financeiro-pro")?.classList.contains("active"))render(S.view);
}
function obs(){
  onSnapshot(collection(db,"produtos"),snapshot=>{S.p=snapshot.docs.map(row=>({id:row.id,...row.data()}));rerenderActive();});
  onSnapshot(collection(db,"vendas"),snapshot=>{S.v=snapshot.docs.map(row=>({id:row.id,...row.data()}));rerenderActive();});
  onSnapshot(collection(db,"movimentosFinanceiros"),snapshot=>{S.m=snapshot.docs.map(row=>({id:row.id,...row.data()}));rerenderActive();});
  onSnapshot(collection(db,"sessoesCaixa"),snapshot=>{S.c=snapshot.docs.map(row=>({id:row.id,...row.data()}));rerenderActive();});
  onSnapshot(collection(db,"contasReceber"),snapshot=>{S.r=snapshot.docs.map(row=>({id:row.id,...row.data()}));rerenderActive();});
}
function go(){page();obs();}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",go):go();
