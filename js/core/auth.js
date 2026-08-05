import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc, serverTimestamp } from "./firebase.js";
import { APP_CONFIG } from "./config.js";
import { createUserChip } from "./templates.js";

window.usuarioAtual = null;
window.isAdmin = false;

async function salvarUsuario(user) {
  const ref = doc(db, "usuarios", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      nome: user.displayName || "",
      email: user.email || "",
      foto: user.photoURL || "",
      tipo: APP_CONFIG.admins.includes(user.email) ? "admin" : "cliente",
      criadoEm: serverTimestamp()
    });
  }
}

window.loginGoogle = async function () {
  try {
    const resultado = await signInWithPopup(auth, googleProvider);
    await salvarUsuario(resultado.user);
  } catch (erro) {
    console.error(erro);
    alert("Erro ao entrar com Google.");
  }
};

window.sairConta = async function () { await signOut(auth); };

export function iniciarAuth() {
  onAuthStateChanged(auth, async (user) => {
    window.usuarioAtual = user;
    window.isAdmin = user ? APP_CONFIG.admins.includes(user.email) : false;

    const area = document.getElementById("areaUsuario");
    const adminArea = document.getElementById("adminUsuario");

    if (!user) {
      if (area) {
        area.innerHTML = '';
        const b = document.createElement('button');
        b.className = 'btn-login-google';
        b.textContent = 'Entrar com Google';
        b.addEventListener('click', () => window.loginGoogle && window.loginGoogle());
        area.appendChild(b);
      }

      if (adminArea) {
        adminArea.innerHTML = '';
        const b2 = document.createElement('button');
        b2.className = 'btn-login-google';
        b2.textContent = 'Entrar como administrador';
        b2.addEventListener('click', () => window.loginGoogle && window.loginGoogle());
        adminArea.appendChild(b2);
      }

      document.body.classList.remove("admin-liberado");
      return;
    }

    await salvarUsuario(user);

    if (area) {
      area.innerHTML = '';
      area.appendChild(createUserChip(user, window.isAdmin));
    }

    if (adminArea) {
      adminArea.innerHTML = '';
      if (!window.isAdmin) {
        const blocked = document.createElement('div');
        blocked.className = 'admin-blocked';
        const strong = document.createElement('strong'); strong.textContent = 'Acesso negado'; blocked.appendChild(strong);
        const p = document.createElement('p'); p.textContent = 'Este e-mail não é administrador.'; blocked.appendChild(p);
        const btn = document.createElement('button'); btn.textContent = 'Sair'; btn.addEventListener('click', () => window.sairConta && window.sairConta()); blocked.appendChild(btn);
        adminArea.appendChild(blocked);
        document.body.classList.remove("admin-liberado");
        return;
      }

      const chip = createUserChip(user, true);
      // prepend ADM label
      const span = chip.querySelector('span');
      if (span) span.textContent = 'ADM: ' + (user.displayName || user.email);
      adminArea.appendChild(chip);
      document.body.classList.add("admin-liberado");
      if (typeof window.iniciarAdminDepoisLogin === "function") window.iniciarAdminDepoisLogin();
    }
  });
}
