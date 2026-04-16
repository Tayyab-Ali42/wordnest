// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";

import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyB2s9nBm6O4e6qx_1Z51rOekbqQPoBm7_4",
    authDomain: "wordnest-15914.firebaseapp.com",
    projectId: "wordnest-15914",
    storageBucket: "wordnest-15914.firebasestorage.app",
    messagingSenderId: "969324753243",
    appId: "1:969324753243:web:984377d0ba02161dbe2a7e",
    measurementId: "G-PSMS2GH7FP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});