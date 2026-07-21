// FCM background handler for Flutter web.
// JS SDK version must match firebase_core_web (see firebase_sdk_version.dart).
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-app-compat.js');
importScripts(
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging-compat.js',
);

firebase.initializeApp({
  apiKey: 'AIzaSyCNLc0HegGS4jAK9iAoFbyaP8NCcmM6or0',
  appId: '1:607753279046:web:8843439e0eb7bd639e5c47',
  messagingSenderId: '607753279046',
  projectId: 'spendmanager-341f8',
  authDomain: 'spendmanager-341f8.firebaseapp.com',
  storageBucket: 'spendmanager-341f8.firebasestorage.app',
});

// Required so the SDK can receive background messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((message) => {
  console.log('[firebase-messaging-sw.js] onBackgroundMessage', message);
});
