// DRIFT — local config. This file is gitignored. Do not commit or push it.
//
// 1) Firebase: console.firebase.google.com → your project → ⚙ → Web app → copy config
// 2) Gemini:   aistudio.google.com/apikey → Create API key
//
// The game runs WITHOUT these (local word list, offline judge, no GEM),
// but Firestore is required for a second device to join.

window.DRIFT_CONFIG = {
  firebase: {
    apiKey: "PASTE_ME",
    authDomain: "PASTE_ME.firebaseapp.com",
    projectId: "PASTE_ME",
    storageBucket: "PASTE_ME.appspot.com",
    messagingSenderId: "PASTE_ME",
    appId: "PASTE_ME",
  },
  geminiKey: "PASTE_ME",
};
