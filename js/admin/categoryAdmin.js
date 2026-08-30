import { categorias, observarCategorias, salvarCategoria, excluirCategoria, criarCategoriasBase } from "../services/categoryService.js";
import { limparTexto, gerarId } from "../core/utils.js";

let categoriaEditando = null;

export function iniciarCategoriasAdmin() {
  observarCategorias(() => {
    renderCategoriasAdmin();
    window.renderDashboardSite?.();
  });
}

export function renderCategoriasAdmin() {
  const box = document.getElementById("listaCategoriasAdmin");
  if (!box) return;

  box.innerHTML = "";

  if (!categorias.length) {
    const p = document.createElement('p'); p.textContent = 'Nenhuma categoria cadastrada ainda.'; box.appendChild(p); return;
  }

  categorias.forEach(categoria => {
    const row = document.createElement('div'); row.className = 'categoria-admin';
    const info = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = `${categoria.emoji || '🏷️'} ${categoria.nome}`; info.appendChild(strong);
    const ativa = categoria.ativa !== false;
    const meta = document.createElement('p'); meta.textContent = `Ordem: ${categoria.ordem || 0} · ${ativa ? 'Ativa' : 'Inativa'} · ${categoria.tituloSelecao || 'Escolha uma opção'}`; info.appendChild(meta);

    const actions = document.createElement('div'); actions.className = 'actions';
    const btnEdit = document.createElement('button'); btnEdit.textContent = 'Editar'; btnEdit.addEventListener('click', () => abrirModalCategoria(categoria.id));
    const btnToggle = document.createElement('button'); btnToggle.textContent = ativa ? 'Desativar' : 'Ativar'; btnToggle.addEventListener('click', async () => {
      await salvarCategoria({ ...categoria, ativa: !ativa });
    });
    const btnDel = document.createElement('button'); btnDel.textContent = 'Arquivar'; btnDel.title = 'Desativa a categoria sem apagar o histórico'; btnDel.addEventListener('click', async () => {
      if (!ativa) return;
      if (!confirm(`Arquivar a categoria "${categoria.nome}"? Os produtos não serão apagados.`)) return;
      await salvarCategoria({ ...categoria, ativa: false });
    });
    actions.appendChild(btnEdit); actions.appendChild(btnToggle); actions.appendChild(btnDel);

    row.appendChild(info);
    row.appendChild(actions);
    box.appendChild(row);
  });
}

export function abrirModalCategoria(id = null) {
  categoriaEditando = id ? categorias.find(c => c.id === id) : null;

  document.getElementById('categoriaModalTitulo').textContent = categoriaEditando ? 'Editar categoria' : 'Nova categoria';
  document.getElementById('categoriaNome').value = categoriaEditando?.nome || '';
  document.getElementById('categoriaEmoji').value = categoriaEditando?.emoji || '';
  document.getElementById('categoriaOrdem').value = categoriaEditando?.ordem || 0;
  document.getElementById('categoriaTituloSelecao').value = categoriaEditando?.tituloSelecao || 'Escolha uma opção';
  document.getElementById('categoriaAtiva').checked = categoriaEditando?.ativa ?? true;

  document.getElementById('modalCategoria').classList.add('aberto');
}

export function fecharModalCategoria() {
  categoriaEditando = null;
  document.getElementById('modalCategoria').classList.remove('aberto');
}

export async function salvarCategoriaAdmin() {
  const nome = limparTexto(document.getElementById('categoriaNome').value);
  const emoji = document.getElementById('categoriaEmoji').value || '🏷️';
  const ordem = Number(document.getElementById('categoriaOrdem').value || 0);
  const tituloSelecao = limparTexto(document.getElementById('categoriaTituloSelecao').value) || 'Escolha uma opção';
  const ativa = document.getElementById('categoriaAtiva').checked;

  if (!nome) {
    alert('Digite o nome da categoria.');
    return;
  }

  const id = categoriaEditando?.id || gerarId(nome);

  await salvarCategoria({
    id,
    nome,
    emoji,
    ordem,
    tituloSelecao,
    ativa
  });

  fecharModalCategoria();
}

export function criarCategoriasBaseAdmin() {
  criarCategoriasBase();
}
