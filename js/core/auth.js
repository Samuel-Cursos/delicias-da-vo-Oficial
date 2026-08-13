import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc, serverTimestamp } from "./firebase.js";
import { APP_CONFIG } from "./config.js";
import { createUserChip } from "./templates.js";
import { limparTexto } from "./utils.js";
import { ativarConviteEquipe, buscarConviteEquipe } from "../services/managementService.js";

window.usuarioAtual = null;
window.isAdmin = false;
window.podeEditarSite = false;
window.perfilClienteAtual = null;

function emailAdministrador(email = "") {
  return APP_CONFIG.admins.some(admin => admin.toLowerCase() === String(email).toLowerCase());
}

function limparEndereco(endereco = {}) {
  return {
    rua: limparTexto(endereco.rua || "").slice(0, 160),
    numero: limparTexto(endereco.numero || "").slice(0, 30),
    bairro: limparTexto(endereco.bairro || "").slice(0, 100),
    complemento: limparTexto(endereco.complemento || "").slice(0, 180)
  };
}

function perfilComIdentidade(user, dados = {}) {
  return {
    uid: user.uid,
    nome: limparTexto(dados.nome || user.displayName || "").slice(0, 120),
    email: user.email || dados.email || "",
    foto: user.photoURL || dados.foto || "",
    tipo: emailAdministrador(user.email) ? "admin" : "cliente",
    telefone: limparTexto(dados.telefone || "").slice(0, 30),
    endereco: limparEndereco(dados.endereco || {})
  };
}

function emitirPerfil(user, perfil) {
  window.perfilClienteAtual = perfil;
  window.dispatchEvent(new CustomEvent("perfil-cliente-atualizado", {
    detail: { usuario: user, perfil }
  }));
}

async function carregarOuCriarUsuario(user) {
  const ref = doc(db, "usuarios", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const novoPerfil = perfilComIdentidade(user);
    await setDoc(ref, {
      ...novoPerfil,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    return novoPerfil;
  }

  const perfil = perfilComIdentidade(user, snap.data());

  await setDoc(ref, {
    nome: perfil.nome,
    foto: perfil.foto,
    telefone: perfil.telefone,
    endereco: perfil.endereco,
    atualizadoEm: serverTimestamp()
  }, { merge: true });

  return perfil;
}

window.salvarPerfilCliente = async function (dados = {}) {
  const user = auth.currentUser;
  if (!user) return null;

  const atual = window.perfilClienteAtual || {};
  const perfil = perfilComIdentidade(user, {
    ...atual,
    ...dados,
    endereco: dados.endereco || atual.endereco || {}
  });

  await setDoc(doc(db, "usuarios", user.uid), {
    nome: perfil.nome,
    foto: perfil.foto,
    telefone: perfil.telefone,
    endereco: perfil.endereco,
    atualizadoEm: serverTimestamp()
  }, { merge: true });

  emitirPerfil(user, perfil);
  return perfil;
};

window.loginGoogle = async function () {
  try {
    // O onAuthStateChanged abaixo é o único responsável por carregar/criar o
    // perfil. Fazer isso também aqui causava duas gravações simultâneas e a
    // segunda podia ser recusada pelas regras para contas de clientes.
    await signInWithPopup(auth, googleProvider);
  } catch (erro) {
    console.error(erro);
    if (erro?.code !== "auth/popup-closed-by-user") {
      alert(`Não foi possível entrar com o Google agora. Tente novamente.\n${erro?.code || "Erro de autenticação"}`);
    }
  }
};

window.sairConta = async function () {
  await signOut(auth);
};

export function iniciarAuth() {
  onAuthStateChanged(auth, async user => {
    window.usuarioAtual = user;
    window.isAdmin = user ? emailAdministrador(user.email) : false;
    window.podeEditarSite = window.isAdmin;

    const area = document.getElementById("areaUsuario");
    const adminArea = document.getElementById("adminUsuario");

    if (!user) {
      window.perfilClienteAtual = null;
      window.dispatchEvent(new CustomEvent("perfil-cliente-atualizado", {
        detail: { usuario: null, perfil: null }
      }));

      if (area) {
        area.innerHTML = "";
        const botao = document.createElement("button");
        botao.className = "btn-login-google";
        botao.textContent = "Entrar com Google";
        botao.title = "Salvar nome e endereço para os próximos pedidos";
        botao.addEventListener("click", () => window.loginGoogle?.());
        area.appendChild(botao);
      }

      if (adminArea) {
        adminArea.innerHTML = "";
        const botao = document.createElement("button");
        botao.className = "btn-login-google";
        botao.textContent = "Entrar como administrador";
        botao.addEventListener("click", () => window.loginGoogle?.());
        adminArea.appendChild(botao);
      }

      document.body.classList.remove("admin-liberado");
      return;
    }

    if (adminArea && !window.isAdmin) {
      try {
        let membroSnapshot = await getDoc(doc(db, "equipe", user.uid));
        let membro = membroSnapshot.exists() ? membroSnapshot.data() : null;
        if (!membro?.ativo) {
          const convite = await buscarConviteEquipe(user).catch(() => null);
          if (convite?.ativo === true && convite.status === "pendente") membro = await ativarConviteEquipe(user);
        }
        window.podeEditarSite = Boolean(membro?.ativo && membro?.permissoes?.site);
      } catch (erro) {
        console.error("Não foi possível conferir o acesso ao editor do site:", erro);
        window.podeEditarSite = false;
      }
    }

    let perfil;

    try {
      perfil = await carregarOuCriarUsuario(user);
    } catch (erro) {
      console.error("Não foi possível carregar o perfil:", erro);
      perfil = perfilComIdentidade(user);
    }

    emitirPerfil(user, perfil);

    if (area) {
      area.innerHTML = "";
      area.appendChild(createUserChip(user, window.isAdmin));
    }

    if (adminArea) {
      adminArea.innerHTML = "";

      if (!window.podeEditarSite) {
        const blocked = document.createElement("div");
        blocked.className = "admin-blocked";
        const strong = document.createElement("strong");
        strong.textContent = "Acesso negado";
        blocked.appendChild(strong);
        const p = document.createElement("p");
        p.textContent = "Este e-mail não possui acesso ao editor do site.";
        blocked.appendChild(p);
        const btn = document.createElement("button");
        btn.textContent = "Sair";
        btn.addEventListener("click", () => window.sairConta?.());
        blocked.appendChild(btn);
        adminArea.appendChild(blocked);
        document.body.classList.remove("admin-liberado");
        return;
      }

      const chip = createUserChip(user, window.isAdmin);
      const span = chip.querySelector("span");
      if (span) span.textContent = `${window.isAdmin ? "ADM" : "EDITOR"}: ${user.displayName || user.email}`;
      adminArea.appendChild(chip);
      document.body.classList.add("admin-liberado");
      window.iniciarAdminDepoisLogin?.();
    }
  });
}
