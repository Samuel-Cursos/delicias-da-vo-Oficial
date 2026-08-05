import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, serverTimestamp, query, where, runTransaction, increment, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

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

export { storageRef, uploadBytes, getDownloadURL, deleteObject };

export { signInWithPopup, signOut, onAuthStateChanged, collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, serverTimestamp, query, where, runTransaction, increment, Timestamp };
