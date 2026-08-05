export function createUserChip(user, isAdmin) {
  const div = document.createElement('div');
  div.className = 'user-chip';

  const span = document.createElement('span');
  const nomeCompleto = user.displayName || user.email || '';
  span.textContent = isAdmin ? nomeCompleto : (nomeCompleto.split(/\s+/)[0] || nomeCompleto);
  span.title = nomeCompleto;

  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    div.appendChild(img);
  }
  div.appendChild(span);

  if (isAdmin) {
    const a = document.createElement('a');
    a.href = 'pages/admin.html';
    a.textContent = 'ADM';
    div.appendChild(a);
  } else {
    const dados = document.createElement('button');
    dados.type = 'button';
    dados.className = 'user-chip-dados';
    dados.textContent = 'Dados';
    dados.title = 'Editar nome, WhatsApp e endereço';
    dados.addEventListener('click', () => { if (typeof window.abrirPerfilCliente === 'function') window.abrirPerfilCliente(); });
    div.appendChild(dados);
  }

  const btn = document.createElement('button');
  btn.textContent = 'Sair';
  btn.addEventListener('click', () => { if (typeof window.sairConta === 'function') window.sairConta(); });
  div.appendChild(btn);

  return div;
}

export function createProductCard(produto, options = {}) {
  const card = document.createElement('div');
  card.className = 'produto-card';

  const statusSpan = document.createElement('span');
  statusSpan.className = 'badge ' + (options.statusClass || 'ok');
  statusSpan.textContent = options.badgeText || '';
  if (options.promo) statusSpan.className = 'promo-site';
  card.appendChild(statusSpan);

  const emoji = document.createElement('div');
  emoji.className = 'emoji';
  emoji.textContent = produto.emoji || '🍽️';
  card.appendChild(emoji);

  const h3 = document.createElement('h3');
  h3.textContent = produto.nome;
  card.appendChild(h3);

  const p = document.createElement('p');
  p.textContent = options.description || produto.descricao || '';
  card.appendChild(p);

  const ingredientesTexto = Array.isArray(produto.ingredientes)
    ? produto.ingredientes.filter(Boolean).join(", ")
    : (produto.ingredientes || "");

  if (ingredientesTexto) {
    const ingredientes = document.createElement('div');
    ingredientes.className = 'ingredientes-card';
    ingredientes.innerHTML = `<strong>Ingredientes:</strong> ${ingredientesTexto}`;
    card.appendChild(ingredientes);
  }

  if (options.showOldPrice && produto.preco != null) {
    const old = document.createElement('span');
    old.className = 'preco-antigo';
    old.textContent = Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(produto.preco);
    card.appendChild(old);
  }

  const preco = document.createElement('span');
  preco.className = 'preco';
  preco.textContent = Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(options.price ?? produto.preco ?? 0);
  card.appendChild(preco);

  const btn = document.createElement('button');
  btn.textContent = options.buttonText || (options.available ? 'Adicionar' : 'Indisponível');
  if (!options.available) btn.disabled = true;
  btn.type = 'button';
  btn.addEventListener('click', () => {
    if (typeof window.adicionarCarrinho === 'function') window.adicionarCarrinho(produto.id);
  });
  card.appendChild(btn);

  return card;
}

export function createProductAdminRow(p) {
  const row = document.createElement('div');
  row.className = 'produto-admin';

  // thumbnail
  const thumbWrap = document.createElement('div'); thumbWrap.className = 'produto-thumb';
  const thumbImg = document.createElement('img'); thumbImg.src = p.imagem || ''; thumbImg.alt = p.nome || 'Imagem';
  thumbWrap.appendChild(thumbImg);

  const info = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = (p.emoji || '🍽️') + ' ' + p.nome;
  info.appendChild(strong);
  const meta = document.createElement('p');
  meta.textContent = `${p.categoria} · ${Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.preco)}`;
  info.appendChild(meta);
  const status = document.createElement('span');
  status.className = 'badge ' + (p.ativo === false ? 'off' : (p.sobEncomenda ? 'ok' : 'ok'));
  status.textContent = p.sobEncomenda ? 'Sob encomenda' : (p.ativo === false ? 'Indisponível' : 'Disponível');
  info.appendChild(status);

  const estoque = document.createElement('div');
  const estP = document.createElement('p');
  const estStrong = document.createElement('strong');
  estStrong.textContent = (p.sobEncomenda ? 'Sob encomenda' : (p.estoque || 0));
  estP.appendChild(document.createTextNode('Estoque: '));
  estP.appendChild(estStrong);
  estoque.appendChild(estP);
  const minP = document.createElement('p'); minP.textContent = 'Mínimo: ' + (p.minimo || 0); estoque.appendChild(minP);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const btnEdit = document.createElement('button'); btnEdit.textContent = 'Editar'; btnEdit.addEventListener('click', () => window.abrirModalProduto && window.abrirModalProduto(p.id));
  const btnToggle = document.createElement('button'); btnToggle.textContent = p.ativo === false ? 'Ativar' : 'Desativar'; btnToggle.addEventListener('click', () => window.alternarAtivo && window.alternarAtivo(p.id));
  const btnDel = document.createElement('button'); btnDel.textContent = 'Excluir'; btnDel.addEventListener('click', () => window.excluirProdutoAdmin && window.excluirProdutoAdmin(p.id));
  actions.appendChild(btnEdit); actions.appendChild(btnToggle); actions.appendChild(btnDel);

  row.appendChild(thumbWrap);
  row.appendChild(info);
  row.appendChild(estoque);
  row.appendChild(actions);

  return row;
}

export function createPromoAdminCard(p, formatarMoeda) {
  const card = document.createElement('div');
  card.className = 'promocao-card';

  const left = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = `${p.produtoEmoji || '🎁'} ${p.titulo}`; left.appendChild(strong);
  const pnome = document.createElement('p'); pnome.textContent = p.produtoNome || 'Produto'; left.appendChild(pnome);
  const status = document.createElement('span'); status.className = 'promo-status ' + (p.ativa ? 'promo-on' : 'promo-off'); status.textContent = p.ativa ? 'Ativa' : 'Inativa'; left.appendChild(status);

  const center = document.createElement('div');
  const old = document.createElement('span'); old.className = 'promo-old'; old.textContent = formatarMoeda(p.precoOriginal); center.appendChild(old);
  const newp = document.createElement('div'); newp.className = 'promo-preco'; newp.textContent = formatarMoeda(p.precoPromocional); center.appendChild(newp);
  const dur = document.createElement('p'); dur.textContent = `${p.inicio || 'Sem início'} até ${p.fim || 'sem fim'}`; center.appendChild(dur);

  const actions = document.createElement('div'); actions.className = 'actions';
  const btnEdit = document.createElement('button'); btnEdit.textContent = 'Editar'; btnEdit.addEventListener('click', () => window.abrirModalPromocao && window.abrirModalPromocao(p.id));
  const btnToggle = document.createElement('button'); btnToggle.textContent = p.ativa ? 'Desativar' : 'Ativar'; btnToggle.addEventListener('click', () => window.alternarPromocao && window.alternarPromocao(p.id));
  const btnDel = document.createElement('button'); btnDel.textContent = 'Excluir'; btnDel.addEventListener('click', () => window.excluirPromocaoAdmin && window.excluirPromocaoAdmin(p.id));
  actions.appendChild(btnEdit); actions.appendChild(btnToggle); actions.appendChild(btnDel);

  card.appendChild(left); card.appendChild(center); card.appendChild(actions);

  return card;
}
