import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, collectionGroup, doc, getDoc, getDocs, setDoc as firebaseSetDoc, updateDoc as firebaseUpdateDoc, deleteDoc as firebaseDeleteDoc, addDoc as firebaseAddDoc, onSnapshot, serverTimestamp, query, where, runTransaction as firebaseRunTransaction, increment, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes as firebaseUploadBytes, getDownloadURL, deleteObject as firebaseDeleteObject } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";
import { APP_CONFIG } from "./config.js";

const firebaseConfig = {
  apiKey: "AIzaSyCQzlseF8cyjwPIvX3TjPCznZojDMV2SIo",
  authDomain: "delicias-da-vo-70953.firebaseapp.com",
  projectId: "delicias-da-vo-70953",
  storageBucket: "delicias-da-vo-70953.firebasestorage.app",
  messagingSenderId: "305694279613",
  appId: "1:305694279613:web:55e101f3c5f9958d2df4d4",
  measurementId: "G-9NCD1CYJ1F"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export const storage = getStorage(app);

function bloquearEscritaNaPrevia() {
  if (!APP_CONFIG.previewMode) return;
  const erro = new Error("Esta é uma prévia segura. As alterações não são enviadas ao sistema oficial.");
  erro.code = "preview/read-only";
  throw erro;
}

export function setDoc(...args) { bloquearEscritaNaPrevia(); return firebaseSetDoc(...args); }
export function updateDoc(...args) { bloquearEscritaNaPrevia(); return firebaseUpdateDoc(...args); }
export function deleteDoc(...args) { bloquearEscritaNaPrevia(); return firebaseDeleteDoc(...args); }
export function addDoc(...args) { bloquearEscritaNaPrevia(); return firebaseAddDoc(...args); }
export function runTransaction(...args) { bloquearEscritaNaPrevia(); return firebaseRunTransaction(...args); }
export function uploadBytes(...args) { bloquearEscritaNaPrevia(); return firebaseUploadBytes(...args); }
export function deleteObject(...args) { bloquearEscritaNaPrevia(); return firebaseDeleteObject(...args); }

export { storageRef, getDownloadURL };

export { signInWithPopup, signOut, onAuthStateChanged, collection, collectionGroup, doc, getDoc, getDocs, onSnapshot, serverTimestamp, query, where, increment, Timestamp };
