// FCM background handler for Flutter web.
// JS SDK version must match firebase_core_web (see firebase_sdk_version.dart).
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-app-compat.js');
importScripts(
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging-compat.js',
);

firebase.initializeApp({
  apiKey: 'AIzaSyDTV0UD-ijjA9qe9QAAdVEifPoitom55DU',
  appId: '1:765310118545:web:31d0dfba2376f2c208ed30',
  messagingSenderId: '765310118545',
  projectId: 'timemanager-e01f3',
  authDomain: 'timemanager-e01f3.firebaseapp.com',
  storageBucket: 'timemanager-e01f3.firebasestorage.app',
});

// Required so the SDK can receive background messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((message) => {
  console.log('[firebase-messaging-sw.js] onBackgroundMessage', message);
});
